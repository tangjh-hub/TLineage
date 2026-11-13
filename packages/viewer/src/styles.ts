export const styles = String.raw`
:root {
  color-scheme: dark;
  --bg:#0B0B0C; --map:#07080D; --panel:#0D0D0F; --card:#111113;
  --border:#232327; --text:#ECECEE; --muted:#8E8E93; --accent:#7CE3C0; --warn:#E8B36A;
  --font:Inter,system-ui,"PingFang SC","Noto Sans SC",sans-serif;
  --mono:"JetBrains Mono",ui-monospace,Menlo,monospace;
  background:var(--bg); color:var(--text); font:13px/1.55 var(--font);
}
* { box-sizing:border-box }
body { margin:0; min-width:300px }
button,select { font:inherit; color:inherit; background:var(--card); border:1px solid var(--border); border-radius:8px; min-height:32px }
button:not(:disabled),select { cursor:pointer }
button:disabled { color:var(--muted); cursor:not-allowed }
button:focus-visible, select:focus-visible, a:focus-visible { outline:2px solid var(--accent); outline-offset:3px }
.skip { position:fixed; z-index:10; top:8px; left:8px; transform:translateY(-160%); background:var(--card); color:var(--accent); padding:8px 12px }
.skip:focus { transform:none }
.shell { display:grid; grid-template-columns:216px minmax(0,1fr) 380px; min-height:100svh }
.rail,.inspector { background:var(--panel); min-width:0 }
.rail { border-right:1px solid var(--border); padding:24px 16px; display:flex; flex-direction:column; gap:24px }
.brand { display:flex; align-items:center; gap:10px; font-weight:650; font-size:15px; margin:0 8px }
.brand svg { flex:none }
.project { background:var(--card); border:1px solid var(--border); border-radius:10px; padding:8px 10px }
.project label { display:block; color:var(--muted); font-size:11px }
.project select { width:100%; font:12px var(--mono); border:0; background:transparent; min-height:29px }
.nav { background:#19191C; padding:8px 12px; border-radius:8px; font-weight:600 }
.rail-stats { color:var(--muted); margin:auto 8px 0; font-size:12px; white-space:pre-line }
.main { padding:24px 28px 20px; min-width:0 }
.head { display:flex; align-items:flex-start; justify-content:space-between; flex-wrap:wrap; gap:12px; margin-bottom:14px }
h1,h2,h3,p { margin:0 }
h1,h2 { font-size:20px; line-height:1.25; font-weight:640; letter-spacing:-.025em }
h3 { font-size:13px; font-weight:600 }
.subtitle { margin-top:6px; color:var(--muted); font-size:12px; display:flex; align-items:center; flex-wrap:wrap; gap:8px }
.demo { display:inline-flex; color:var(--accent); font-size:11px; border:1px solid #365249; border-radius:20px; padding:1px 8px }
.demo[hidden] { display:none }
.filters,.tools,.zoom,.legend { display:flex; flex-wrap:wrap; gap:7px; align-items:center }
.filters button { padding:3px 11px; border-radius:20px; color:var(--muted); background:transparent }
button[aria-pressed="true"] { color:var(--accent); border-color:#45665B; background:#142420 }
.tools { justify-content:space-between; padding:9px 12px; border-bottom:1px solid var(--border); min-height:50px }
.tools label { display:flex; align-items:center; gap:6px; color:var(--text); font-size:12px; min-height:28px; cursor:pointer }
.tools input { accent-color:var(--accent); width:14px; height:14px }
.zoom button { min-width:30px; min-height:27px; padding:0 7px }
#view-toggle { min-height:27px; padding:0 8px; font-size:11px }
.board { border:1px solid var(--border); border-radius:14px; background:var(--map); overflow:hidden }
.chart { height:clamp(420px,calc(100svh - 264px),900px); position:relative; touch-action:none; overflow:hidden; cursor:grab }
.chart.dragging { cursor:grabbing }
.chart svg { display:block; width:100%; height:100%; user-select:none }
.star { cursor:pointer; outline:none }
.star .focus-ring { opacity:0 }
.star:focus-visible .focus-ring { opacity:1 }
.star:focus .focus-ring { stroke:var(--accent) }
.plot-label { fill:var(--text); font:11px var(--font); pointer-events:none }
.axis { fill:var(--muted); font:11px var(--mono); pointer-events:none }
.band-name { font:600 11px var(--font); pointer-events:none }
.legend { color:var(--muted); padding:10px 13px; border-top:1px solid var(--border); font-size:11px; gap:6px 14px }
.legend i { width:6px;height:6px;border-radius:50%; background:var(--warn); display:inline-block; margin-right:5px }
.controls { color:var(--muted); padding:9px 2px; font-size:11px }
.footer { color:var(--muted); margin-top:9px; font-size:11px }
.inspector { border-left:1px solid var(--border); padding:25px 23px; overflow-wrap:anywhere }
.inspector h2 { margin:9px 0 9px }
.meta,.muted { color:var(--muted) }
.meta { font-size:11px; display:flex; align-items:center; flex-wrap:wrap; gap:6px }
.pill { color:var(--accent); border:1px solid #365249; border-radius:20px; padding:1px 7px; font-size:11px }
.pill[data-status="warn"] { color:var(--warn); border-color:#654C33 }
.pill[data-status="idle"] { color:var(--muted); border-color:var(--border) }
.inspector .section { margin-top:17px; padding-top:12px; border-top:1px solid var(--border) }
.section h3 { margin-bottom:6px }
.inspector ul { margin:0; padding-left:16px; font-size:12px }
.inspector li { margin:3px 0 }
.files { font-family:var(--mono) }
.numbers { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:4px 8px; margin:4px 0 0; font-size:12px }
.numbers dt { color:var(--muted) }
.numbers dd { margin:0; text-align:right; font-family:var(--mono) }
.handoff { background:var(--card); border:1px solid var(--border); border-radius:12px; padding:14px; margin-top:18px }
.handoff p { margin:5px 0 10px; color:var(--muted); font-size:12px }
.handoff button { width:100%; min-height:34px }
.handoff-preview { width:100%; resize:vertical; background:var(--bg); color:var(--text); border:1px solid var(--border); padding:8px; font:11px var(--mono); border-radius:6px; margin:6px 0 }
.list { overflow:auto; max-height:clamp(420px,calc(100svh - 264px),900px); min-height:220px }
[hidden] { display:none!important }
table { width:100%; border-collapse:collapse; text-align:left; font-size:12px }
thead { position:sticky; top:0; z-index:1; background:var(--card); color:var(--muted) }
th,td { padding:9px 10px; border-bottom:1px solid var(--border); vertical-align:middle }
td:first-child { width:35% }
td button { text-align:left; border:0; background:transparent; min-height:26px; padding:2px 4px; overflow-wrap:anywhere }
tr[data-selected="true"] { background:#172220 }
.empty { text-align:center; color:var(--muted); padding:28px 10px }
.tooltip { position:fixed; z-index:5; pointer-events:none; width:max-content; max-width:min(310px,calc(100vw - 16px)); background:var(--card); border:1px solid #36363C; border-radius:10px; padding:10px 12px; overflow-wrap:anywhere }
.tooltip h3 { margin-bottom:3px }
.tooltip p { margin:4px 0 }
.tooltip .numbers { font-size:11px }
@media (max-width:1200px) { .shell { grid-template-columns:186px minmax(0,1fr) 310px } .main { padding-inline:20px } .inspector { padding-inline:17px } }
@media (max-width:970px) { .shell { grid-template-columns:160px minmax(0,1fr) } .inspector { grid-column:2; border-top:1px solid var(--border); border-left:0 } .rail { grid-row:1 / 3 } }
@media (max-width:620px) { .shell { display:block } .rail { flex-direction:row; flex-wrap:wrap; gap:10px; padding:12px; border-right:0;border-bottom:1px solid var(--border) } .rail-stats,.nav { display:none } .project { flex:1; min-width:140px } .main { padding:14px 10px } .inspector { padding:17px 14px } .chart { height:460px } th,td { padding:7px 5px } }
`;
