import type { McpServer } from "@modelcontextprotocol/server";
import type { FinancePresentationKind } from "@personal-os/domain";

export const financePresentationResourceUris = {
  finance_budget: "ui://ilo/finances/budget",
  finance_period_verification: "ui://ilo/finances/period-verification",
  finance_review: "ui://ilo/finances/review",
  finance_snapshot: "ui://ilo/finances/snapshot",
} as const satisfies Record<FinancePresentationKind, `ui://ilo/${string}`>;

const presentationTitles = {
  finance_budget: "Finance budget",
  finance_period_verification: "Finance period verification",
  finance_review: "Finance review",
  finance_snapshot: "Financial snapshot",
} as const satisfies Record<FinancePresentationKind, string>;

function presentationDocument(kind: FinancePresentationKind): string {
  const expectedKind = JSON.stringify(kind);
  const appTitle = JSON.stringify(presentationTitles[kind]);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${presentationTitles[kind]}</title>
<style>
:root{color-scheme:light dark;font:14px/1.5 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;--bg:light-dark(#f7f7f5,#171716);--card:light-dark(#fff,#222220);--ink:light-dark(#20201e,#f3f2ee);--muted:light-dark(#676661,#b4b2aa);--line:light-dark(#deddd8,#3e3d38);--accent:light-dark(#1d5fd1,#9bb9ff);--critical-bg:light-dark(#fff0ed,#3b211e);--important-bg:light-dark(#fff8df,#352f1d)}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink)}main{padding:16px;overflow-wrap:anywhere}.card{max-width:720px;border:1px solid var(--line);border-radius:16px;background:var(--card);padding:18px}h1,h2,p,dl,ul{margin-top:0}h1{font-size:21px;line-height:1.2;margin-bottom:6px}h2{font-size:14px;margin:18px 0 8px}.eyebrow{margin-bottom:7px;color:var(--muted);font-size:11px;font-weight:700;letter-spacing:.11em;text-transform:uppercase}.summary,.as-of,.secondary{color:var(--muted)}.as-of{font-size:12px;margin-bottom:16px}.metrics,.facts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-bottom:14px}.metric,.fact{border:1px solid var(--line);border-radius:11px;padding:10px}.metric dt,.fact dt{color:var(--muted);font-size:12px}.metric dd,.fact dd{font-size:16px;font-weight:650;margin:2px 0 0}.fact dd{font-size:13px}.disclosures{display:grid;gap:8px;margin:0 0 14px}.disclosure{border:1px solid var(--line);border-radius:10px;padding:10px}.disclosure[data-importance="critical"]{background:var(--critical-bg)}.disclosure[data-importance="important"]{background:var(--important-bg)}ul{padding-left:20px}.items{display:grid;gap:7px;padding:0;list-style:none}.item{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;border-bottom:1px solid var(--line);padding:7px 0}.item-copy{min-width:0}.item-title{font-weight:600}.amount{white-space:nowrap;font-variant-numeric:tabular-nums}.prompt{border-left:3px solid var(--accent);padding:3px 0 3px 12px;font-size:16px;font-weight:600}.action{display:inline-block;margin-top:12px;color:var(--accent);font-weight:650;text-underline-offset:3px}details{border-top:1px solid var(--line);margin-top:16px;padding-top:12px}summary{cursor:pointer;font-weight:600}.fallback{margin:0;color:var(--muted)}a:focus-visible,summary:focus-visible{outline:3px solid var(--accent);outline-offset:3px}@media(max-width:480px){main{padding:10px}.card{padding:14px}.metrics,.facts{grid-template-columns:1fr}.item{display:block}.amount{display:block;margin-top:3px}}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}
</style>
</head>
<body><main><p class="fallback">This result is available in chat.</p></main>
<script>
(function(){
const EXPECTED_KIND=${expectedKind};
const APP_TITLE=${appTitle};
const main=document.querySelector('main');
let initialized=false;
let currentLinks=null;
let requestNumber=0;
const initializeId='ilo-finance-'+String(Date.now());
function send(message){parent.postMessage(message,'*')}
function node(tag,className,text){const value=document.createElement(tag);if(className)value.className=className;if(text!==undefined)value.textContent=String(text);return value}
function clearMain(){main.replaceChildren()}
function fallback(){clearMain();main.append(node('p','fallback','This result is available in chat.'))}
function money(value){if(value===null||typeof value!=='number'||!Number.isFinite(value))return 'Unavailable';return new Intl.NumberFormat('en-US',{currency:'USD',style:'currency'}).format(value)}
function display(value){if(value===null||value===undefined)return 'Unavailable';if(typeof value==='boolean')return value?'Yes':'No';return String(value)}
function metric(list,label,value,formatter){const wrapper=node('div','metric');const term=node('dt','',label);const detail=node('dd','',formatter?formatter(value):display(value));wrapper.append(term,detail);list.append(wrapper)}
function itemList(){const list=node('ul','items');return list}
function disclosures(values){if(!Array.isArray(values)||values.length===0)return;const aside=node('aside','disclosures');aside.setAttribute('aria-label','Important information');const ordered=[...values].sort((left,right)=>(left.importance==='critical'?0:1)-(right.importance==='critical'?0:1));for(const value of ordered){const message=node('p','disclosure',value.message);message.dataset.importance=value.importance;aside.append(message)}main.querySelector('.card').append(aside)}
function header(presentation){const card=node('section','card');card.append(node('p','eyebrow',presentation.eyebrow),node('h1','',presentation.title),node('p','summary',presentation.summary));main.append(card);return card}
function snapshot(presentation,card){card.append(node('p','as-of','As of '+presentation.asOf));const list=node('dl','metrics');metric(list,'Net worth',presentation.position.netWorth,money);metric(list,'Cash',presentation.position.cash,money);metric(list,'Debt',presentation.position.debt,money);metric(list,'Investments',presentation.position.investments,money);card.append(list);const trust=node('p','secondary',presentation.trust.trustworthy?'Evidence is current and reconciled.':'Evidence needs attention.');card.append(trust);if(Array.isArray(presentation.trust.gaps)&&presentation.trust.gaps.length){const heading=node('h2','','Unresolved gaps');const gaps=node('ul','');for(const gap of presentation.trust.gaps)gaps.append(node('li','',gap));card.append(heading,gaps)}}
function budget(presentation,card){const list=node('dl','metrics');metric(list,'Expected resources',presentation.expectedResources,money);metric(list,'Allocated',presentation.totalAllocated,money);metric(list,'Balance',presentation.balance,money);metric(list,'Status',presentation.status);card.append(list);const heading=node('h2','','Allocations');const allocations=itemList();for(const allocation of presentation.allocations){const row=node('li','item');row.dataset.allocation='true';const copy=node('div','item-copy');copy.append(node('div','item-title',allocation.key));if(allocation.description)copy.append(node('div','secondary',allocation.description));row.append(copy,node('span','amount',money(allocation.amount)));allocations.append(row)}card.append(heading,allocations);if(presentation.assumptions.length){const assumptionsHeading=node('h2','','Assumptions');const assumptions=node('ul','');for(const value of presentation.assumptions)assumptions.append(node('li','',value));card.append(assumptionsHeading,assumptions)}}
function review(presentation,card){const list=node('dl','metrics');metric(list,'Potential impact',presentation.impactAmount,money);metric(list,'Evidence sources',presentation.evidenceCount);card.append(list,node('p','secondary',presentation.reason),node('p','prompt',presentation.prompt))}
function period(presentation,card){card.append(node('p','as-of',presentation.period.start+' through '+presentation.period.end+' · evidence cutoff '+presentation.cutoff));const list=node('dl','metrics');metric(list,'Approvals',presentation.work.approvals);metric(list,'Exceptions',presentation.work.exceptions);metric(list,'Questions',presentation.work.questions);metric(list,'Rules and actions',presentation.work.rulesAndActions);card.append(list);if(presentation.recommendations.length){const heading=node('h2','','Recommendations');const recommendations=itemList();for(const recommendation of presentation.recommendations){const row=node('li','item');row.dataset.recommendation='true';const copy=node('div','item-copy');copy.append(node('div','item-title',recommendation.recommendation),node('div','secondary',recommendation.disposition.replaceAll('_',' ')));row.append(copy);recommendations.append(row)}card.append(heading,recommendations)}}
function diagnostics(presentation,card){if(!Array.isArray(presentation.diagnosticFacts)||presentation.diagnosticFacts.length===0)return;const details=node('details','');const summary=node('summary','','Details');const list=node('dl','facts');for(const fact of presentation.diagnosticFacts.slice(0,50))metric(list,fact.label,fact.value);details.append(summary,list);card.append(details)}
function safeDestination(presentation){const approvalUrl=currentLinks&&currentLinks.approvals;if(!presentation.destination||typeof approvalUrl!=='string')return null;try{const base=new URL(approvalUrl);const resolved=new URL(presentation.destination.href,base.origin);if(base.protocol!=='https:'||resolved.protocol!=='https:'||resolved.origin!==base.origin)return null;return resolved.href}catch{return null}}
function destination(presentation,card){const href=safeDestination(presentation);if(!href)return;const link=node('a','action',presentation.destination.label);link.href=href;link.addEventListener('click',event=>{event.preventDefault();requestNumber+=1;send({id:'open-link-'+String(requestNumber),jsonrpc:'2.0',method:'ui/open-link',params:{url:href}})});card.append(link)}
function structured(payload){return payload&&payload.structuredContent||payload&&payload.params&&payload.params.structuredContent||payload&&payload.params&&payload.params.result&&payload.params.result.structuredContent||null}
function toolPresentation(payload){const content=structured(payload);return content&&content.presentation||null}
function text(value,maximum){return typeof value==='string'&&value.length>0&&value.length<=maximum}
function scalar(value){return value===null||typeof value==='boolean'||typeof value==='string'&&value.length<=2000||typeof value==='number'&&Number.isFinite(value)}
function moneyValue(value){return value===null||typeof value==='number'&&Number.isFinite(value)}
function nonnegativeMoney(value){return typeof value==='number'&&Number.isFinite(value)&&value>=0}
function validBase(value){return value&&text(value.eyebrow,120)&&text(value.title,240)&&text(value.summary,1000)&&Array.isArray(value.disclosures)&&value.disclosures.length<=20&&value.disclosures.every(item=>item&&['critical','important'].includes(item.importance)&&text(item.message,2000))&&Array.isArray(value.diagnosticFacts)&&value.diagnosticFacts.length<=50&&value.diagnosticFacts.every(item=>item&&text(item.label,160)&&scalar(item.value))&&(value.destination===null||value.destination&&text(value.destination.label,120)&&text(value.destination.href,2000)&&value.destination.href.startsWith('/'))}
function validPresentation(value){if(!validBase(value)||value.kind!==EXPECTED_KIND)return false;if(value.kind==='finance_snapshot')return text(value.asOf,100)&&value.position&&moneyValue(value.position.cash)&&moneyValue(value.position.debt)&&moneyValue(value.position.investments)&&moneyValue(value.position.netWorth)&&value.trust&&typeof value.trust.trustworthy==='boolean'&&['current','partial','stale','unavailable'].includes(value.trust.state)&&Array.isArray(value.trust.gaps)&&value.trust.gaps.length<=50&&value.trust.gaps.every(item=>text(item,500));if(value.kind==='finance_budget')return nonnegativeMoney(value.expectedResources)&&nonnegativeMoney(value.totalAllocated)&&typeof value.balance==='number'&&Number.isFinite(value.balance)&&['incomplete','proposed','active','retired'].includes(value.status)&&Array.isArray(value.allocations)&&value.allocations.length<=500&&value.allocations.every(item=>item&&text(item.key,120)&&nonnegativeMoney(item.amount)&&['buffer','debt','goal','savings','spending'].includes(item.kind)&&(item.description===null||text(item.description,500)))&&Array.isArray(value.assumptions)&&value.assumptions.length<=100&&value.assumptions.every(item=>text(item,1000));if(value.kind==='finance_review')return Number.isInteger(value.evidenceCount)&&value.evidenceCount>=0&&moneyValue(value.impactAmount)&&text(value.prompt,1000)&&text(value.reason,500);if(value.kind==='finance_period_verification')return text(value.cutoff,100)&&value.period&&text(value.period.start,20)&&text(value.period.end,20)&&['completed','completed_with_questions'].includes(value.status)&&value.work&&['approvals','exceptions','questions','rulesAndActions'].every(key=>Number.isInteger(value.work[key])&&value.work[key]>=0)&&Array.isArray(value.recommendations)&&value.recommendations.length<=25&&value.recommendations.every(item=>item&&['monitor','needs_input','ready'].includes(item.disposition)&&text(item.recommendation,1000));return false}
function render(payload){const content=structured(payload);currentLinks=content&&content._ilo&&content._ilo.links||null;const presentation=toolPresentation(payload);if(!validPresentation(presentation)){fallback();reportSize();return}clearMain();const card=header(presentation);disclosures(presentation.disclosures);if(EXPECTED_KIND==='finance_snapshot')snapshot(presentation,card);else if(EXPECTED_KIND==='finance_budget')budget(presentation,card);else if(EXPECTED_KIND==='finance_review')review(presentation,card);else if(EXPECTED_KIND==='finance_period_verification')period(presentation,card);diagnostics(presentation,card);destination(presentation,card);reportSize()}
function applyHostContext(context){if(context&&context.theme)document.documentElement.style.colorScheme=context.theme}
function reportSize(){if(!initialized)return;send({jsonrpc:'2.0',method:'ui/notifications/size-changed',params:{height:document.documentElement.scrollHeight,width:document.documentElement.scrollWidth}})}
addEventListener('message',event=>{if(event.source!==parent)return;const message=event.data;if(!message||message.jsonrpc!=='2.0')return;if(message.id===initializeId&&message.result){initialized=true;applyHostContext(message.result.hostContext);send({jsonrpc:'2.0',method:'ui/notifications/initialized',params:{}});reportSize();return}if(message.method==='ui/notifications/tool-result'){render(message.params);return}if(message.method==='ui/notifications/host-context-changed'){applyHostContext(message.params);reportSize();return}if(message.method==='ui/resource-teardown'&&message.id!==undefined){send({id:message.id,jsonrpc:'2.0',result:{}})}});
new ResizeObserver(()=>requestAnimationFrame(reportSize)).observe(document.documentElement);
send({id:initializeId,jsonrpc:'2.0',method:'ui/initialize',params:{appCapabilities:{},appInfo:{name:'ilo-finance-presentation',title:APP_TITLE,version:'0.1.0'},protocolVersion:'2026-01-26'}});
})();
</script></body></html>`;
}

export const financePresentationDocuments = Object.fromEntries(
  (Object.keys(financePresentationResourceUris) as FinancePresentationKind[]).map((kind) => [
    kind,
    presentationDocument(kind),
  ]),
) as Record<FinancePresentationKind, string>;

export function registerFinancePresentationResources(server: McpServer): void {
  for (const kind of Object.keys(financePresentationResourceUris) as FinancePresentationKind[]) {
    const uri = financePresentationResourceUris[kind];
    server.registerResource(
      kind,
      uri,
      {
        description: `A compact, read-only ${presentationTitles[kind]} presentation.`,
        mimeType: "text/html;profile=mcp-app",
        title: presentationTitles[kind],
      },
      async (resourceUri) => ({
        contents: [
          {
            _meta: { ui: { prefersBorder: true } },
            mimeType: "text/html;profile=mcp-app",
            text: financePresentationDocuments[kind],
            uri: resourceUri.href,
          },
        ],
      }),
    );
  }
}
