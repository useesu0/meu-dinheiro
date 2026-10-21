export const clone = value => structuredClone(value);
export const todayBR = () => new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo'}).format(new Date());
export const money = cents => cents === null || cents === undefined ? 'Não informado' : new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(cents/100);
export function parseMoney(value){
  let text=String(value).trim().replace(/R\$\s*/g,'').replace(/\s/g,'');
  if(text.includes(','))text=text.replace(/\./g,'').replace(',','.');
  if(!/^-?\d+(\.\d{1,2})?$/.test(text))throw new Error('Informe um valor válido, como 60,00.');
  const result=Math.round(Number(text)*100);if(!Number.isSafeInteger(result)||Math.abs(result)>1e11)throw new Error('Valor fora do limite.');return result;
}
export const salaryForMonth = (month,parameters={}) => (parameters.base||0)+(month<(parameters.benefitEnd||'')?(parameters.benefit||0):0);
export const historyTotal = rows => Math.round(rows.reduce((n,r)=>n+Math.round((r.originalAmount??r.amount/100)*1000),0)/10);
export function monthDate(date,delta){const [y,m,d]=date.split('-').map(Number);const start=new Date(Date.UTC(y,m-1+delta,1));const last=new Date(Date.UTC(start.getUTCFullYear(),start.getUTCMonth()+1,0)).getUTCDate();return `${start.getUTCFullYear()}-${String(start.getUTCMonth()+1).padStart(2,'0')}-${String(Math.min(d,last)).padStart(2,'0')}`;}
export function nextPayday(state,today){const e=state.events.filter(e=>e.kind==='salary'&&e.status==='planned'&&e.date>today).sort((a,b)=>a.date.localeCompare(b.date))[0];return e?.date||monthDate(today,1);}
export function previousDay(date){const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-1);return d.toISOString().slice(0,10);}
export function dashboard(state,today=todayBR(),until=previousDay(nextPayday(state,today))){
  let balance=state.settings.balance, minimum=balance, income=0,expenses=0;
  const events=state.events.filter(e=>e.status==='planned'&&e.date&&e.date<=until&&(e.direction==='out'||e.confirmed)).sort((a,b)=>a.date.localeCompare(b.date)||(a.direction==='out'?-1:1));
  const daily=[{date:today,balance}];
  for(const e of events){const amount=e.direction==='in'?e.amount:-e.amount;balance+=amount;if(amount>0)income+=amount;else expenses-=amount;minimum=Math.min(minimum,balance);daily.push({date:e.date<today?today:e.date,balance});}
  const deferred=state.events.filter(e=>e.direction==='out'&&e.status==='deferred').reduce((n,e)=>n+e.amount,0);
  const undated=state.events.filter(e=>e.direction==='out'&&e.status==='planned'&&!e.date).reduce((n,e)=>n+e.amount,0);
  const newCredit=state.events.filter(e=>e.direction==='out'&&e.status==='planned'&&e.source==='quick'&&e.date>until).reduce((n,e)=>n+e.amount,0);
  const essentials=state.settings.essentials, safety=state.settings.safety||0;
  const potential=Math.max(0,minimum-deferred-undated-newCredit-(essentials||0)-safety);
  const incomplete=!state.settings.reconciled||essentials===null;
  let free=incomplete?0:potential;
  const month=today.slice(0,7);const spent=state.purchases.filter(p=>!p.void&&p.date.startsWith(month)&&p.budget==='Desejos'&&p.person==='JEFFERSON'&&!['VR','VA'].includes(p.payment)).reduce((n,p)=>n+p.amount,0);
  if(state.settings.monthlyLimit!==null&&state.settings.monthlyLimit!==undefined)free=Math.min(free,Math.max(0,state.settings.monthlyLimit-spent));
  const days=Math.max(1,Math.ceil((new Date(until+'T12:00:00Z')-new Date(today+'T12:00:00Z'))/86400000)+1);
  return {today,until,free,potential,weekly:Math.min(free,Math.floor(free*7/days)),minimum,endBalance:balance,income,expenses,deferred,undated,newCredit,essentials,safety,incomplete,daily,spent};
}
export const PAYMENTS=['Pix','Dinheiro','ITAU','CLICK','PASSAÍ','BRADESCO','NUBANK','VR','VA'];
const isCard=p=>!['Pix','Dinheiro','VR','VA'].includes(p);
export function addPurchase(state,input){
  if(!Number.isSafeInteger(input.amount)||input.amount<=0)throw new Error('O valor deve ser maior que zero.');
  if(!input.description?.trim()||!/^\d{4}-\d{2}-\d{2}$/.test(input.date)||!PAYMENTS.includes(input.payment))throw new Error('Confira descrição, data e pagamento.');
  const count=Number(input.installments||1);if(!Number.isInteger(count)||count<1||count>60||count>input.amount)throw new Error('Confira o número de parcelas.');
  if(isCard(input.payment)&&(!/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate||'')||input.dueDate<input.date))throw new Error('Informe o vencimento da fatura, a partir da data da compra.');
  if(!isCard(input.payment)&&count!==1)throw new Error('Parcelamento disponível somente para cartão.');
  if(state.purchases.some(p=>p.id===input.id))throw new Error('Este lançamento já foi salvo.');
  const s=clone(state),p={...input,person:input.person||'JEFFERSON',installments:count,description:input.description.trim(),void:false};s.purchases.push(p);
  if(['VR','VA'].includes(p.payment)){if(s.settings.benefits[p.payment]!==null)s.settings.benefits[p.payment]-=p.amount;}
  else if(!isCard(p.payment))s.settings.balance-=p.amount;
  else {const v=Math.floor(p.amount/count),rest=p.amount%count;for(let i=0;i<count;i++)s.events.push({id:`purchase-${p.id}-${i}`,purchaseId:p.id,date:monthDate(p.dueDate,i),description:`${p.description}${count>1?` · ${i+1}/${count}`:''}`,amount:v+(i<rest?1:0),direction:'out',status:'planned',confirmed:true,source:'quick',kind:'card',account:p.payment,person:p.person,category:p.category});}
  if(p.person!=='JEFFERSON'&&!['VR','VA'].includes(p.payment))s.events.push({id:`reimbursement-${p.id}`,purchaseId:p.id,date:p.reimbursementDate||'',description:`${p.person} · reembolso de ${p.description}`,amount:p.amount,direction:'in',status:'planned',confirmed:!!p.reimbursementDate,source:'quick',kind:'reimbursement',person:p.person,account:'Conta'});
  return s;
}
export function settleEvent(state,id,date=todayBR(),alreadyIncluded=false){const s=clone(state),e=s.events.find(e=>e.id===id);if(!e||!['planned','deferred'].includes(e.status))throw new Error('Este compromisso já foi conciliado.');e.previousStatus=e.status;e.status=alreadyIncluded?'covered':'paid';e.paidDate=date;e.applied=alreadyIncluded?0:(e.direction==='in'?e.amount:-e.amount);s.settings.balance+=e.applied;return s;}
export function restoreEvent(state,id){const s=clone(state),e=s.events.find(e=>e.id===id);if(!e||!['paid','covered'].includes(e.status))throw new Error('Compromisso não conciliado.');s.settings.balance-=e.applied||0;e.status=e.previousStatus||'planned';delete e.applied;delete e.paidDate;return s;}
export function undoPurchase(state,id){const s=clone(state),p=s.purchases.find(p=>p.id===id);if(!p||p.void)throw new Error('Lançamento já desfeito.');const linked=s.events.filter(e=>e.purchaseId===id);if(linked.some(e=>['paid','covered'].includes(e.status)))throw new Error('Desfaça primeiro a conciliação dos pagamentos desta compra na Agenda.');p.void=true;for(const e of linked)e.status='void';if(['Pix','Dinheiro'].includes(p.payment))s.settings.balance+=p.amount;else if(['VR','VA'].includes(p.payment)&&s.settings.benefits[p.payment]!==null)s.settings.benefits[p.payment]+=p.amount;return s;}
export function validateState(s){
  if(!s||s.version!==1||!s.settings||!Array.isArray(s.events)||!Array.isArray(s.purchases)||!Array.isArray(s.history)||s.events.length>15000||s.purchases.length>10000)throw new Error('Backup ou controle inválido.');
  const cents=(n,nullable=false)=>{if(nullable&&n===null)return;if(!Number.isSafeInteger(n)||Math.abs(n)>1e11)throw new Error('Valor monetário inválido.');};
  const date=(d,blank=false)=>{if(blank&&d==='')return;if(typeof d!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(d)||isNaN(Date.parse(d+'T12:00:00Z')))throw new Error('Data inválida.');};
  cents(s.settings.balance);cents(s.settings.essentials,true);cents(s.settings.safety);cents(s.settings.monthlyLimit,true);if(s.settings.essentials<0||s.settings.safety<0||s.settings.monthlyLimit<0)throw new Error('Provisões devem ser positivas ou zero.');date(s.settings.asOf);
  if(!s.settings.benefits)throw new Error('Benefícios ausentes.');for(const n of Object.values(s.settings.benefits))cents(n,true);
  const ids=new Set();for(const e of s.events){if(typeof e.id!=='string'||ids.has(e.id))throw new Error('Compromisso duplicado.');ids.add(e.id);cents(e.amount);if(e.amount<=0||!['in','out'].includes(e.direction)||!['planned','paid','covered','deferred','void'].includes(e.status))throw new Error('Compromisso inválido.');date(e.date,true);if(e.applied!==undefined)cents(e.applied);if(typeof e.description!=='string'||e.description.length>500)throw new Error('Descrição inválida.');}
  const purchases=new Set();for(const p of s.purchases){if(typeof p.id!=='string'||purchases.has(p.id))throw new Error('Lançamento duplicado.');purchases.add(p.id);cents(p.amount);date(p.date);if(p.amount<=0||!PAYMENTS.includes(p.payment)||typeof p.description!=='string'||p.description.length>500)throw new Error('Lançamento inválido.');}
  return s;
}
