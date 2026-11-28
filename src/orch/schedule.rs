//! `[[schedule]]` runs (H.8): a team deployed on a cron line, when the default
//! branch moves (`on = "push"`) or when another branch moves (`on = "pr"`).
//! `kula serve` ticks the scheduler; one scheduled run goes at a time, and a run
//! missed while nothing was serving is caught up once.
//! What it has seen and fired lives in `.kula/schedules.json`.

use super::deploy::{self, DeployOpts};
use crate::config::{Config, Schedule};
use crate::git::Repo;
use anyhow::{bail, Result};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::process::Child;

// ---- cron ----------------------------------------------------------------

/// Five cron fields as bit sets: minute hour day month weekday (Sunday is 0).
#[derive(Debug, Clone, PartialEq)]
pub struct Cron {
    min: u64,
    hour: u32,
    dom: u32,
    mon: u16,
    dow: u8,
    dom_any: bool,
    dow_any: bool,
}

fn field(s: &str, lo: u32, hi: u32) -> Result<u64> {
    let mut bits = 0u64;
    for part in s.split(',') {
        let (range, step) = match part.split_once('/') {
            Some((r, st)) => (r, st.parse::<u32>().ok().filter(|n| *n > 0).ok_or_else(|| anyhow::anyhow!("bad step in {part}"))?),
            None => (part, 1),
        };
        let (a, b) = if range == "*" {
            (lo, hi)
        } else if let Some((a, b)) = range.split_once('-') {
            (a.parse()?, b.parse()?)
        } else {
            let a: u32 = range.parse().map_err(|_| anyhow::anyhow!("bad cron field {part}"))?;
            (a, if part.contains('/') { hi } else { a })
        };
        if a < lo || b > hi || a > b {
            bail!("{part} is out of range {lo} to {hi}");
        }
        let mut v = a;
        while v <= b {
            bits |= 1 << v;
            v += step;
        }
    }
    Ok(bits)
}

impl Cron {
    pub fn parse(s: &str) -> Result<Cron> {
        let f: Vec<&str> = s.split_whitespace().collect();
        if f.len() != 5 {
            bail!("a cron line has five fields: minute hour day month weekday");
        }
        let mut dow = field(f[4], 0, 7)?;
        if dow & (1 << 7) != 0 {
            dow = (dow | 1) & 0x7f;
        }
        Ok(Cron {
            min: field(f[0], 0, 59)?,
            hour: field(f[1], 0, 23)? as u32,
            dom: field(f[2], 1, 31)? as u32,
            mon: field(f[3], 1, 12)? as u16,
            dow: dow as u8,
            dom_any: f[2] == "*",
            dow_any: f[4] == "*",
        })
    }

    fn day_ok(&self, days: i64) -> bool {
        let (_, m, d) = civil(days);
        if self.mon & (1 << m) == 0 {
            return false;
        }
        let wd = (days + 4).rem_euclid(7) as u32; // 1970-01-01 was a Thursday
        let dom = self.dom & (1 << d) != 0;
        let dow = self.dow & (1 << wd) != 0;
        // Cron's rule: with both day fields set, either one may match.
        match (self.dom_any, self.dow_any) {
            (true, true) => true,
            (false, true) => dom,
            (true, false) => dow,
            (false, false) => dom || dow,
        }
    }

    /// Whether minute `t` (minutes since the epoch, local time) matches.
    #[cfg(test)]
    pub fn matches(&self, t: i64) -> bool {
        let days = t.div_euclid(1440);
        let mm = t.rem_euclid(1440);
        self.day_ok(days) && self.hour & (1 << (mm / 60)) != 0 && self.min & (1 << (mm % 60)) != 0
    }

    /// The first matching minute after `t`, within a year.
    pub fn next_after(&self, t: i64) -> Option<i64> {
        let mut x = t + 1;
        let end = t + 366 * 1440;
        while x <= end {
            let days = x.div_euclid(1440);
            if !self.day_ok(days) {
                x = (days + 1) * 1440;
                continue;
            }
            let mm = x.rem_euclid(1440);
            if self.hour & (1 << (mm / 60)) == 0 {
                x = days * 1440 + (mm / 60 + 1) * 60;
                continue;
            }
            if self.min & (1 << (mm % 60)) != 0 {
                return Some(x);
            }
            x += 1;
        }
        None
    }
}

/// Days since the epoch to (year, month, day) (Howard Hinnant's civil_from_days).
fn civil(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (yoe + era * 400 + i64::from(m <= 2), m, d)
}

/// Local time's offset from UTC in seconds, from `date +%z`.
fn utc_offset() -> i64 {
    let out = std::process::Command::new("date").arg("+%z").output().ok();
    let s = out.map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string()).unwrap_or_default();
    let (sign, rest) = match s.split_at_checked(1) {
        Some(("-", r)) => (-1, r),
        Some(("+", r)) => (1, r),
        _ => return 0,
    };
    let h: i64 = rest.get(..2).and_then(|x| x.parse().ok()).unwrap_or(0);
    let m: i64 = rest.get(2..4).and_then(|x| x.parse().ok()).unwrap_or(0);
    sign * (h * 3600 + m * 60)
}

/// Epoch ms as local "2026-11-16 03:00" for the CLI.
pub fn local(ms: i64) -> String {
    let t = ms / 1000 + utc_offset();
    let (y, m, d) = civil(t.div_euclid(86_400));
    let mins = t.rem_euclid(86_400) / 60;
    format!("{y}-{m:02}-{d:02} {:02}:{:02}", mins / 60, mins % 60)
}

fn now_secs() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

/// When a cron schedule last fired (or first seen) at `last` is next due, in
/// epoch seconds. A never seen schedule counts from a minute ago, so a line
/// that matches every minute is due at once.
pub fn next_due(cron: &Cron, last: Option<i64>, now: i64, off: i64) -> Option<i64> {
    let base = last.unwrap_or(now - 60);
    cron.next_after((base + off).div_euclid(60)).map(|m| m * 60 - off)
}

// ---- state ---------------------------------------------------------------

#[derive(Serialize, Deserialize, Default, Clone, Debug)]
#[serde(default)]
pub struct Seen {
    /// Epoch seconds of the last fire.
    pub last: Option<i64>,
    pub paused: bool,
    /// Branch heads last seen, for push and pr schedules.
    pub refs: Option<BTreeMap<String, String>>,
    /// The run it last started.
    pub run: String,
    /// Why the last fire failed to start.
    #[serde(skip_serializing_if = "String::is_empty")]
    pub error: String,
}

#[derive(Serialize, Deserialize, Default, Debug)]
#[serde(default)]
pub struct State {
    pub schedules: BTreeMap<String, Seen>,
}

fn state_path(repo: &Repo) -> PathBuf {
    repo.kula_dir().join("schedules.json")
}

pub fn load(repo: &Repo) -> State {
    std::fs::read_to_string(state_path(repo)).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

fn save(repo: &Repo, st: &State) -> Result<()> {
    std::fs::create_dir_all(repo.kula_dir())?;
    std::fs::write(state_path(repo), serde_json::to_string_pretty(st)? + "\n")?;
    Ok(())
}

/// Pause or resume a schedule by its key.
pub fn set_paused(repo: &Repo, key: &str, paused: bool) -> Result<()> {
    let cfg = Config::load(&repo.root)?;
    if !cfg.schedules.iter().any(|s| s.key() == key) {
        bail!("no schedule named {key}");
    }
    let mut st = load(repo);
    st.schedules.entry(key.to_string()).or_default().paused = paused;
    save(repo, &st)
}

/// What the hub shows for a schedule.
#[derive(Serialize, Debug)]
pub struct Info {
    pub key: String,
    #[serde(flatten)]
    pub schedule: Schedule,
    pub paused: bool,
    /// Epoch ms of the last fire.
    pub last: Option<i64>,
    /// Epoch ms the cron line is next due; none for push and pr schedules.
    pub next: Option<i64>,
    pub run: String,
    pub error: String,
}

pub fn list(repo: &Repo, cfg: &Config) -> Vec<Info> {
    let st = load(repo);
    let (now, off) = (now_secs(), utc_offset());
    cfg.schedules
        .iter()
        .map(|s| {
            let seen = st.schedules.get(&s.key()).cloned().unwrap_or_default();
            let next =
                Cron::parse(&s.cron).ok().and_then(|c| next_due(&c, seen.last.or(Some(now - 60)).map(|l| l.max(now - 60)), now, off));
            let error = if s.cron.is_empty() && s.on.is_empty() {
                "needs cron or on".into()
            } else {
                Cron::parse(&s.cron).err().filter(|_| !s.cron.is_empty()).map(|e| e.to_string()).unwrap_or(seen.error)
            };
            Info {
                key: s.key(),
                schedule: s.clone(),
                paused: seen.paused,
                last: seen.last.map(|l| l * 1000),
                next: next.map(|n| n * 1000),
                run: seen.run,
                error,
            }
        })
        .collect()
}

// ---- ticking -------------------------------------------------------------

/// Branch heads a push or pr schedule watches.
fn watched_refs(repo: &Repo, cfg: &Config, on: &str) -> BTreeMap<String, String> {
    let main = if cfg.project.default_branch.is_empty() { "main" } else { cfg.project.default_branch.as_str() };
    let mut out = BTreeMap::new();
    if on == "push" {
        if let Ok(sha) = repo.run(&["rev-parse", "--verify", "-q", &format!("refs/heads/{main}")]) {
            out.insert(main.to_string(), sha.trim().to_string());
        }
        return out;
    }
    // Remote branches only: kula's own run branches are local and must not wake it.
    let lines = repo.run(&["for-each-ref", "--format=%(refname) %(objectname)", "refs/remotes"]).unwrap_or_default();
    for l in lines.lines() {
        let Some((name, sha)) = l.split_once(' ') else { continue };
        let short = name.trim_start_matches("refs/remotes/");
        let branch = short.split_once('/').map(|(_, b)| b).unwrap_or(short);
        if branch == main || branch == "HEAD" || branch.starts_with("kula/") {
            continue;
        }
        out.insert(short.to_string(), sha.to_string());
    }
    out
}

/// A pr schedule fires when a branch other than the default is new or moved.
fn moved(old: &BTreeMap<String, String>, new: &BTreeMap<String, String>) -> bool {
    new.iter().any(|(k, v)| old.get(k) != Some(v))
}

/// The scheduled run still going, if any.
pub type Running = Option<(String, Child)>;

/// One pass: start the first due schedule when nothing scheduled is running.
/// Returns the keys it started.
pub fn tick(repo: &Repo, running: &mut Running) -> Result<Vec<String>> {
    if let Some((_, child)) = running {
        if child.try_wait()?.is_some() {
            *running = None;
        }
    }
    let cfg = Config::load(&repo.root)?;
    if cfg.schedules.is_empty() {
        return Ok(vec![]);
    }
    let mut st = load(repo);
    let (now, off) = (now_secs(), utc_offset());
    let mut fired = vec![];
    let mut dirty = false;
    for s in &cfg.schedules {
        let key = s.key();
        let seen = st.schedules.entry(key.clone()).or_default();
        let (due, refs) = if !s.cron.is_empty() {
            let Ok(c) = Cron::parse(&s.cron) else { continue };
            (next_due(&c, seen.last, now, off).is_some_and(|n| n <= now), None)
        } else if s.on == "push" || s.on == "pr" {
            let refs = watched_refs(repo, &cfg, &s.on);
            match &seen.refs {
                // First sight only records where things stand.
                None => {
                    seen.refs = Some(refs);
                    dirty = true;
                    (false, None)
                }
                Some(old) => (moved(old, &refs), Some(refs)),
            }
        } else {
            continue;
        };
        if seen.paused {
            // Paused: keep up with the branches so resuming does not fire on old pushes.
            if let Some(r) = refs {
                seen.refs = Some(r);
                dirty = true;
            }
            continue;
        }
        if !due || running.is_some() {
            continue;
        }
        let trigger = if s.cron.is_empty() { s.on.clone() } else { "schedule".to_string() };
        let o = DeployOpts { team: s.team.clone(), goal: s.goal.clone(), flows: s.flows.clone(), budget: s.budget };
        seen.last = Some(now);
        if let Some(r) = refs {
            seen.refs = Some(r);
        }
        dirty = true;
        match deploy::make(repo, &o).and_then(|(plan, path)| deploy::start(repo, &plan, &path, &trigger).map(|c| (plan, c))) {
            Ok((plan, child)) => {
                seen.run = plan.id.clone();
                seen.error.clear();
                *running = Some((key.clone(), child));
                fired.push(key);
            }
            Err(e) => seen.error = format!("{e:#}"),
        }
    }
    if dirty {
        save(repo, &st)?;
    }
    Ok(fired)
}

/// The scheduler thread `kula serve` runs: a tick every `KULA_SCHEDULE_TICK`
/// seconds (30 by default). `KULA_SCHEDULE=0` turns it off.
pub fn spawn(root: PathBuf) {
    if std::env::var("KULA_SCHEDULE").is_ok_and(|v| v == "0") {
        return;
    }
    let every = std::env::var("KULA_SCHEDULE_TICK").ok().and_then(|v| v.parse::<u64>().ok()).filter(|n| *n > 0).unwrap_or(30);
    std::thread::spawn(move || {
        let mut running: Running = None;
        loop {
            if let Ok(repo) = Repo::discover(&root) {
                if let Err(e) = tick(&repo, &mut running) {
                    eprintln!("kula: schedule: {e:#}");
                }
            }
            std::thread::sleep(std::time::Duration::from_secs(every));
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    // 2026-11-15 is a Sunday; minutes since the epoch at 00:00 that day.
    const NOV15: i64 = 20_772 * 1440;

    #[test]
    fn civil_dates() {
        assert_eq!(civil(0), (1970, 1, 1));
        assert_eq!(civil(20_772), (2026, 11, 15));
        assert_eq!((20_772i64 + 4).rem_euclid(7), 0, "a Sunday");
    }

    #[test]
    fn parses_fields() {
        let c = Cron::parse("*/15 3-5 * * 1-5").unwrap();
        assert!(c.matches(NOV15 + 1440 + 3 * 60 + 30)); // Monday 03:30
        assert!(!c.matches(NOV15 + 3 * 60 + 30)); // Sunday
        assert!(!c.matches(NOV15 + 1440 + 3 * 60 + 31));
        assert!(Cron::parse("0 0 * *").is_err());
        assert!(Cron::parse("60 * * * *").is_err());
        assert!(Cron::parse("*/0 * * * *").is_err());
        // 7 is Sunday too.
        assert!(Cron::parse("0 9 * * 7").unwrap().matches(NOV15 + 9 * 60));
        assert!(Cron::parse("5,10 * * * *").unwrap().matches(NOV15 + 10));
    }

    #[test]
    fn next_fire() {
        let c = Cron::parse("0 3 * * *").unwrap();
        assert_eq!(c.next_after(NOV15 + 12 * 60), Some(NOV15 + 1440 + 3 * 60));
        let c = Cron::parse("30 9 1 * *").unwrap();
        assert_eq!(c.next_after(NOV15).map(|m| civil(m.div_euclid(1440))), Some((2026, 12, 1)));
        // Both day fields: either matches (the 1st or any Monday).
        let c = Cron::parse("0 0 1 * 1").unwrap();
        assert_eq!(c.next_after(NOV15), Some(NOV15 + 1440));
    }

    #[test]
    fn due_logic() {
        let off = 0;
        let now = (NOV15 + 12 * 60) * 60 + 20;
        // Every minute: due at once on first sight.
        assert!(next_due(&Cron::parse("* * * * *").unwrap(), None, now, off).is_some_and(|n| n <= now));
        // 03:00 at noon: not due on first sight.
        assert!(next_due(&Cron::parse("0 3 * * *").unwrap(), None, now, off).is_some_and(|n| n > now));
        // Last fired two days ago: the missed 03:00 is due, once.
        let last = now - 2 * 86_400;
        assert!(next_due(&Cron::parse("0 3 * * *").unwrap(), Some(last), now, off).is_some_and(|n| n <= now));
        assert!(next_due(&Cron::parse("0 3 * * *").unwrap(), Some(now), now, off).is_some_and(|n| n > now));
        // An offset shifts the wall clock: 03:00 at UTC+2 is 01:00 UTC.
        let n = next_due(&Cron::parse("0 3 * * *").unwrap(), Some(now), now, 7200).unwrap();
        assert_eq!(n, (NOV15 + 1440 + 60) * 60);
    }

    #[test]
    fn pr_moves() {
        let a: BTreeMap<String, String> = [("origin/x".to_string(), "1".to_string())].into();
        let b: BTreeMap<String, String> = [("origin/x".to_string(), "2".to_string())].into();
        assert!(!moved(&a, &a));
        assert!(moved(&a, &b));
        assert!(!moved(&b, &BTreeMap::new()), "a deleted branch is not work");
    }
}
