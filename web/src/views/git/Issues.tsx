// Issues: the open issues, one click into the desk.
import type { Issue } from "../../api";
import { relTime } from "../../api";
import type { Go } from "../../nav";
import { Icon } from "../../ui";
import { IB, WEmpty, Widget } from "./parts";

export function Issues({ issues, go }: { issues: Issue[]; go?: Go }) {
  return (
    <Widget area="iss" title="Issues" count={issues.length}
      foot={
        <div className="w-line gv-one">
          <span className="grow" />
          <IB tip="Open the issue desk" onClick={() => go?.("issues")}><Icon.arrow /></IB>
        </div>
      }>
      {issues.length === 0 ? <WEmpty icon={<Icon.issues />}>No open issues</WEmpty> : issues.map((i) => (
        <div key={i.id} className="w-row gv-prop" onClick={() => go?.("issues", { issue: i.id })} title={i.title}>
          <span className="w-code gv-num">#{i.id}</span>
          <span className="grow">{i.title}</span>
          <span className="dim gv-when">{relTime(i.updated ?? i.created)}</span>
        </div>
      ))}
    </Widget>
  );
}
