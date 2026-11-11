#!/usr/bin/env bash
# Adoption signal with no telemetry: public counts per channel.
set -u
R=A12N4V/kula
echo "== GitHub"
gh api repos/$R --jq '"stars \(.stargazers_count)  forks \(.forks_count)  watchers \(.subscribers_count)  open issues \(.open_issues_count)"'
gh api repos/$R/traffic/views --jq '"views 14d \(.count) (\(.uniques) unique)"' 2>/dev/null || echo "views: needs push access"
gh api repos/$R/traffic/clones --jq '"clones 14d \(.count) (\(.uniques) unique)"' 2>/dev/null || echo "clones: needs push access"
gh api repos/$R/releases --jq '.[] | "release \(.tag_name): \([.assets[].download_count] | add) downloads"'
echo "== crates.io"
curl -s -H 'User-Agent: kula-stats' https://crates.io/api/v1/crates/kula | python3 -c "import sys,json;c=json.load(sys.stdin)['crate'];print('downloads',c['downloads'],'recent',c['recent_downloads'])"
echo "== PyPI (last month)"
curl -s https://pypistats.org/api/packages/kula/recent | python3 -c "import sys,json;print(json.load(sys.stdin)['data'])" 2>/dev/null || echo "unavailable"
echo "== npm (last month)"
curl -s https://api.npmjs.org/downloads/point/last-month/@kula-cli/kula | python3 -c "import sys,json;print('downloads',json.load(sys.stdin).get('downloads'))"
