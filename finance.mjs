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
export const itemPaidTotal = e => (e.itemPayments||[]).reduce((n,p)=>n+p.amount,0);
export const outstandingAmount = e => Math.max(0,e.amount-itemPaidTotal(e));
export function monthDate(date,delta){const [y,m,d]=date.split('-').map(Number);const start=new Date(Date.UTC(y,m-1+delta,1));const last=new Date(Date.UTC(start.getUTCFullYear(),start.getUTCMonth()+1,0)).getUTCDate();return `${start.getUTCFullYear()}-${String(start.getUTCMonth()+1).padStart(2,'0')}-${String(Math.min(d,last)).padStart(2,'0')}`;}
export function nextPayday(state,today){const e=state.events.filter(e=>e.kind==='salary'&&e.status==='planned'&&e.date>today).sort((a,b)=>a.date.localeCompare(b.date))[0];return e?.date||monthDate(today,1);}
export function previousDay(date){const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-1);return d.toISOString().slice(0,10);}
export function dashboard(state,today=todayBR(),until=previousDay(nextPayday(state,today))){
  let balance=state.settings.balance, minimum=balance, income=0,expenses=0;
  const events=state.events.filter(e=>e.status==='planned'&&e.date&&e.date<=until&&(e.direction==='out'||e.confirmed)).sort((a,b)=>a.date.localeCompare(b.date)||(a.direction==='out'?-1:1));
  const daily=[{date:today,balance}];
  for(const e of events){const amount=e.direction==='in'?e.amount:-outstandingAmount(e);balance+=amount;if(amount>0)income+=amount;else expenses-=amount;minimum=Math.min(minimum,balance);daily.push({date:e.date<today?today:e.date,balance});}
  const deferred=state.events.filter(e=>e.direction==='out'&&e.status==='deferred').reduce((n,e)=>n+outstandingAmount(e),0);
  const undated=state.events.filter(e=>e.direction==='out'&&e.status==='planned'&&!e.date).reduce((n,e)=>n+outstandingAmount(e),0);
  const newCredit=state.events.filter(e=>e.direction==='out'&&e.status==='planned'&&e.source==='quick'&&e.date>until).reduce((n,e)=>n+outstandingAmount(e),0);
  const essentials=state.settings.essentials, safety=state.settings.safety||0;
  const potential=Math.max(0,minimum-deferred-undated-newCredit-(essentials||0)-safety);
  const incomplete=!state.settings.reconciled||essentials===null;
  let free=incomplete?0:potential;
  const month=today.slice(0,7);const spent=state.purchases.filter(p=>!p.void&&p.date.startsWith(month)&&p.budget==='Desejos'&&p.person==='JEFFERSON'&&!['VR','VA'].includes(p.payment)).reduce((n,p)=>n+(p.split?.myAmount??p.amount),0);
  if(state.settings.monthlyLimit!==null&&state.settings.monthlyLimit!==undefined)free=Math.min(free,Math.max(0,state.settings.monthlyLimit-spent));
  const days=Math.max(1,Math.ceil((new Date(until+'T12:00:00Z')-new Date(today+'T12:00:00Z'))/86400000)+1);
  return {today,until,free,potential,weekly:Math.min(free,Math.floor(free*7/days)),minimum,endBalance:balance,income,expenses,deferred,undated,newCredit,essentials,safety,incomplete,daily,spent};
}
export const PAYMENTS=['Pix','Dinheiro','ITAU','CLICK','PASSAÍ','BRADESCO','NUBANK','VR','VA'];
const isCard=p=>!['Pix','Dinheiro','VR','VA'].includes(p);
const validCardDay=day=>Number.isInteger(day)&&day>=1&&day<=31;
const dateOnDay=(month,day)=>monthDate(`${month}-01`,0).slice(0,7)+'-'+String(Math.min(day,new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).getUTCDate())).padStart(2,'0');
export function cardsForState(state){
  if(Array.isArray(state.settings.cards))return state.settings.cards;
  return PAYMENTS.filter(isCard).map(id=>{
    const e=state.events.find(e=>e.account===id&&['invoice','card'].includes(e.kind)&&e.status!=='void'&&/^\d{4}-\d{2}-\d{2}$/.test(e.date||''));
    return {id,name:id,dueDay:e?Number(e.date.slice(-2)):null,closingDay:null};
  });
}
export const paymentName=(state,id)=>cardsForState(state).find(c=>c.id===id)?.name||id;
export const paymentOptions=state=>['Pix','Dinheiro',...cardsForState(state).map(c=>c.id),'VR','VA'];
export function firstCardDueDate(purchaseDate,card){
  if(!card||!validCardDay(card.dueDay)||!validCardDay(card.closingDay))throw new Error('Cadastre vencimento e fechamento do cartão em Ajustes.');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(purchaseDate||''))throw new Error('Informe a data da compra.');
  let month=purchaseDate.slice(0,7),due=dateOnDay(month,card.dueDay);
  if(due<purchaseDate){month=monthDate(month+'-01',1).slice(0,7);due=dateOnDay(month,card.dueDay);}
  const closingMonth=card.closingDay<card.dueDay?month:monthDate(month+'-01',-1).slice(0,7);
  if(purchaseDate>=dateOnDay(closingMonth,card.closingDay))due=dateOnDay(monthDate(month+'-01',1).slice(0,7),card.dueDay);
  return due;
}
const searchable=text=>String(text).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
export function categoryName(value){const raw=String(value||'Outros').trim();return ({'alimentacao':'Alimentação','alimentacao fora':'Alimentação','combustivel':'Combustível','vestiario':'Vestuário','vestuario':'Vestuário'})[searchable(raw)]||raw||'Outros';}
export function groupExpenses(rows){
  const groups=new Map();
  for(const row of rows){
    const category=categoryName(row.category);
    if(!groups.has(category))groups.set(category,{category,rows:[],mills:0});
    const g=groups.get(category);g.rows.push(row);g.mills+=Math.round((row.originalAmount??row.amount/100)*1000);
  }
  const result=[...groups.values()];for(const g of result)g.amount=Math.floor(g.mills/10);
  let missing=Math.round(result.reduce((n,g)=>n+g.mills,0)/10)-result.reduce((n,g)=>n+g.amount,0);
  for(const g of [...result].sort((a,b)=>(b.mills-b.amount*10)-(a.mills-a.amount*10)||a.category.localeCompare(b.category)))if(missing>0){g.amount++;missing--;}
  return result.sort((a,b)=>b.amount-a.amount||a.category.localeCompare(b.category)).map(({mills,...g})=>g);
}
export function expensesForMonth(state,month,person='Todos',search=''){
  const rows=state.history.filter(r=>r.month===month).map(r=>({...r,origin:'source',payment:r.account}));
  const lastMonth=state.history.map(r=>r.month).filter(Boolean).sort().at(-1);
  if(lastMonth&&month>lastMonth){
    const delta=(Number(month.slice(0,4))-Number(lastMonth.slice(0,4)))*12+Number(month.slice(5,7))-Number(lastMonth.slice(5,7));
    for(const r of state.history.filter(r=>r.month===lastMonth&&r.type==='Cartão'&&Number.isInteger(r.part)&&Number.isInteger(r.parts)&&r.part>0&&r.parts>1)){
      const part=r.part+delta;if(part>r.parts)continue;
      rows.push({...r,id:`projection-${r.id}-${month}`,sourceId:r.id,sourceMonth:lastMonth,month,date:'',origin:'source-projection',kind:'source-installment',payment:r.account,part,status:'planned',sourceStatus:'Aberto',projection:true});
    }
  }
  for(const p of state.purchases.filter(p=>!p.void)){
    if(isCard(p.payment)){
      const parts=state.events.filter(e=>e.purchaseId===p.id&&e.kind==='card'&&e.direction==='out').sort((a,b)=>a.id.localeCompare(b.id,undefined,{numeric:true}));
      for(const [i,e] of parts.entries())if(e.status!=='void'&&e.date.startsWith(month))rows.push({...p,id:e.id,purchaseId:p.id,origin:'purchase',date:e.date,purchaseDate:p.date,amount:e.amount,part:i+1,parts:p.installments,status:e.status,paidDate:e.paidDate});
    }else if(p.date.startsWith(month))rows.push({...p,purchaseId:p.id,origin:'purchase'});
  }
  const expanded=rows.map(r=>{
    if(!['source','source-projection'].includes(r.origin))return r;
    const e=sourcePaymentEvent(state,r),payment=e?.itemPayments?.find(p=>p.key===r.id);
    if(e?.kind==='fixed'&&e.amount!==r.amount)r={...r,amount:e.amount,originalAmount:e.amount/100};
    return payment?{...r,status:'paid',paidDate:payment.paidDate,paymentEventId:e.id}:e&&['paid','covered'].includes(e.status)?{...r,status:e.status,paidDate:e.paidDate,paymentEventId:e.id}:e?{...r,paymentEventId:e.id}:r;
  }).flatMap(r=>{
    if(!r.split)return [r];
    const own=Math.floor(r.split.myAmount/(r.parts||1))+((r.part||1)<=r.split.myAmount%(r.parts||1)?1:0);
    const myAmount=r.part?own:r.split.myAmount,otherAmount=r.amount-myAmount;
    const {originalAmount,...clean}=r;
    return [{...clean,person:'JEFFERSON',amount:myAmount},{...clean,person:r.split.person,amount:otherAmount}].filter(x=>x.amount>0);
  });
  const query=searchable(search.trim());
  return expanded.filter(r=>(person==='Todos'||r.person===person)&&(!query||searchable(`${r.description} ${r.category} ${categoryName(r.category)}`).includes(query)));
}
export function agendaForMonth(state,month,status='open',person='Todos'){
  return state.events.filter(e=>status==='deferred'?e.status==='deferred':status==='closed'?['paid','covered','void'].includes(e.status):e.status==='planned')
    .filter(e=>status==='deferred'||!e.date||e.date.startsWith(month))
    .filter(e=>person==='Todos'||(e.person||'JEFFERSON')===person)
    .map(e=>e.itemPayments?.length&&['planned','deferred'].includes(e.status)?{...e,amount:outstandingAmount(e),partialPaid:itemPaidTotal(e),fullAmount:e.amount}:e)
    .sort((a,b)=>(a.date||'0000').localeCompare(b.date||'0000'));
}
export function addPurchase(state,input){
  if(!Number.isSafeInteger(input.amount)||input.amount<=0)throw new Error('O valor deve ser maior que zero.');
  if(!input.description?.trim()||!/^\d{4}-\d{2}-\d{2}$/.test(input.date)||![...PAYMENTS,...paymentOptions(state)].includes(input.payment))throw new Error('Confira descrição, data e pagamento.');
  const count=Number(input.installments||1);if(!Number.isInteger(count)||count<1||count>60||count>input.amount)throw new Error('Confira o número de parcelas.');
  const card=cardsForState(state).find(c=>c.id===input.payment);
  const dueDate=isCard(input.payment)?input.dueDate||firstCardDueDate(input.date,card):undefined;
  if(isCard(input.payment)&&(!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)||dueDate<input.date))throw new Error('Confira os dias do cartão em Ajustes.');
  if(!isCard(input.payment)&&count!==1)throw new Error('Parcelamento disponível somente para cartão.');
  if(state.purchases.some(p=>p.id===input.id))throw new Error('Este lançamento já foi salvo.');
  let split;
  if(input.split){
    const person=String(input.split.person||'').trim().toUpperCase(),percent=Number(input.split.percent);
    if(!person||person==='JEFFERSON'||person.length>80||!Number.isFinite(percent)||percent<0||percent>100)throw new Error('Confira pessoa e percentual da divisão.');
    if(['VR','VA'].includes(input.payment))throw new Error('Divisão não disponível para benefício.');
    const myAmount=Math.round(input.amount*percent/100);split={person,percent,myAmount,otherAmount:input.amount-myAmount};
  }
  const s=clone(state),p={...input,...(split?{split}:{}),...(dueDate?{dueDate,billingDay:input.dueDate?Number(dueDate.slice(-2)):card.dueDay}:{}),person:split?'JEFFERSON':input.person||'JEFFERSON',installments:count,description:input.description.trim(),void:false};s.purchases.push(p);
  if(['VR','VA'].includes(p.payment)){if(s.settings.benefits[p.payment]!==null)s.settings.benefits[p.payment]-=p.amount;}
  else if(!isCard(p.payment))s.settings.balance-=p.amount;
  else {const v=Math.floor(p.amount/count),rest=p.amount%count;for(let i=0;i<count;i++)s.events.push({id:`purchase-${p.id}-${i}`,purchaseId:p.id,date:dateOnDay(monthDate(p.dueDate,i).slice(0,7),p.billingDay),description:`${p.description}${count>1?` · ${i+1}/${count}`:''}`,amount:v+(i<rest?1:0),direction:'out',status:'planned',confirmed:true,source:'quick',kind:'card',account:p.payment,person:split?'Compartilhado':p.person,category:p.category});}
  if((split?.otherAmount>0||p.person!=='JEFFERSON')&&!['VR','VA'].includes(p.payment))s.events.push({id:`reimbursement-${p.id}`,purchaseId:p.id,date:p.reimbursementDate||'',description:`${split?.person||p.person} · reembolso de ${p.description}`,amount:split?.otherAmount??p.amount,direction:'in',status:'planned',confirmed:!!p.reimbursementDate,source:'quick',kind:'reimbursement',person:split?.person||p.person,account:'Conta'});
  if(split?.otherAmount>0&&input.split.received)return settleEvent(s,`reimbursement-${p.id}`,p.date);
  return s;
}
export function settleEvent(state,id,date=todayBR(),alreadyIncluded=false){const s=clone(state),e=s.events.find(e=>e.id===id);if(!e||!['planned','deferred'].includes(e.status))throw new Error('Este compromisso já foi conciliado.');e.previousStatus=e.previousStatus||e.status;const applied=alreadyIncluded?0:(e.direction==='in'?e.amount:-outstandingAmount(e));e.status=alreadyIncluded?'covered':'paid';e.paidDate=date;e.applied=(e.applied||0)+applied;s.settings.balance+=applied;return s;}
export function restoreEvent(state,id){const s=clone(state),e=s.events.find(e=>e.id===id);if(!e||!['paid','covered'].includes(e.status)&&!e.itemPayments?.length)throw new Error('Compromisso não conciliado.');s.settings.balance-=e.applied||0;e.status=e.previousStatus||'planned';delete e.applied;delete e.paidDate;delete e.itemPayments;delete e.previousStatus;return s;}
const editableEvent=e=>e&&['planned','deferred'].includes(e.status)&&!e.itemPayments?.length;
function recurrenceKey(e){
  if(!e||e.direction!=='out'||e.purchaseId||['loan','card','invoice','agreement','installments','settlement'].includes(e.kind))return null;
  if(e.recurrenceId)return 'explicit:'+e.recurrenceId;
  const match=e.source==='source'&&e.kind==='fixed'&&e.id.match(/^fixed-(?:current|\d{4}-\d{2})-(\d+)$/);return match?'source-fixed:'+match[1]:null;
}
const recurrenceMonth=e=>e.source==='source'&&e.kind==='fixed'&&e.id.match(/^fixed-(\d{4}-\d{2})-\d+$/)?.[1]||e.month||e.date?.slice(0,7);
export function recurrenceForEvent(state,id){
  const e=state.events.find(e=>e.id===id),key=recurrenceKey(e),month=e&&recurrenceMonth(e);if(!key||!/^\d{4}-\d{2}$/.test(month||''))return null;
  const targets=state.events.filter(r=>recurrenceKey(r)===key&&(r.person||'JEFFERSON')===(e.person||'JEFFERSON')&&(r.account||'Conta')===(e.account||'Conta')&&recurrenceMonth(r)>=month&&editableEvent(r))
    .sort((a,b)=>recurrenceMonth(a).localeCompare(recurrenceMonth(b))||a.id.localeCompare(b.id));
  return {id:key,month,targets,lastMonth:targets.length?recurrenceMonth(targets.at(-1)):month};
}
export function editEvent(state,input,scope='single'){
  const old=state.events.find(e=>e.id===input.id);if(!editableEvent(old))throw new Error('Reabra a conciliação dos pagamentos antes de editar este compromisso.');
  if(!['single','future'].includes(scope))throw new Error('Escolha alterar só este mês ou a recorrência.');
  if(!Number.isSafeInteger(input.amount)||input.amount<=0)throw new Error('Informe um valor maior que zero em centavos válidos.');
  if(typeof input.description!=='string'||!input.description.trim()||input.description.length>500||!['in','out'].includes(input.direction)||!['planned','deferred','void'].includes(input.status)||typeof input.date!=='string'||input.date!==''&&!/^\d{4}-\d{2}-\d{2}$/.test(input.date))throw new Error('Confira descrição, data e situação do movimento.');
  if(input.direction==='in'&&input.status==='deferred')throw new Error('Use Previsto para uma entrada adiada.');
  if(old.source==='source'&&old.kind==='fixed'&&input.direction!=='out')throw new Error('Uma conta fixa deve permanecer como saída de dinheiro.');
  const recurrence=recurrenceForEvent(state,old.id);if(scope==='future'&&(!recurrence||input.direction!=='out'))throw new Error('Este movimento não pertence a uma recorrência de despesas.');
  const s=clone(state),current=s.events.find(e=>e.id===old.id);
  Object.assign(current,{description:input.description.trim(),amount:input.amount,date:input.date,direction:input.direction,status:input.status,person:input.person||old.person||'JEFFERSON',confirmed:!!input.confirmed&&!!input.date,review:false});
  if(scope==='future')for(const target of recurrence.targets)if(target.id!==old.id)s.events.find(e=>e.id===target.id).amount=input.amount;
  validateState(s);return s;
}
export function receiptsForRows(state,rows){
  const ids=new Set(rows.flatMap(r=>[r.eventId,r.reimbursementId]).filter(Boolean));
  return state.events.filter(e=>ids.has(e.id)&&e.direction==='in'&&e.status==='planned');
}
// A competência da planilha precede a fatura cadastrada na importação original.
function sourcePaymentEvent(state,row){
  const original=state.history.find(r=>r.id===(row.sourceId||row.id));if(!original)return null;
  if(original.type==='Fixa')return state.events.find(e=>e.id===`fixed-current-${original.row}`&&row.month===original.month)||null;
  if(original.type!=='Cartão')return null;
  const month=monthDate(row.month+'-01',1).slice(0,7),lastMonth=state.history.map(r=>r.month).filter(Boolean).sort().at(-1);if(row.month<lastMonth)return null;
  const stableIds=row.month===lastMonth?[`nubank-${original.row}`,`invoice-${original.account}`,...(original.account==='BRADESCO'?['camila-bradesco']:[])]:[`install-${month}-${original.account}`];
  const stable=state.events.find(e=>stableIds.includes(e.id)&&e.source==='source'&&e.direction==='out'&&e.account===original.account);if(stable)return stable;
  const candidates=state.events.filter(e=>e.source==='source'&&e.direction==='out'&&e.account===original.account&&(e.date?e.date.slice(0,7):e.month)===month);
  const individual=candidates.find(e=>['agreement','settlement'].includes(e.kind)&&e.description===original.description&&e.id.endsWith('-'+original.row));
  if(individual)return individual;
  const grouped=candidates.filter(e=>['invoice','installments','settlement'].includes(e.kind));return grouped.length===1?grouped[0]:null;
}
function sourceItemAmounts(state,month){
 const groups=new Map(),amounts=new Map();
 for(const r of expensesForMonth(state,month).filter(r=>['source','source-projection'].includes(r.origin))){
   const e=sourcePaymentEvent(state,r);if(!e)continue;if(!groups.has(e.id))groups.set(e.id,[]);
   const mills=Math.round((r.originalAmount??r.amount/100)*1000);groups.get(e.id).push({id:r.id,eventId:e.id,mills,amount:Math.floor(mills/10)});
 }
 for(const list of groups.values()){
   let rest=Math.round(list.reduce((n,r)=>n+r.mills,0)/10)-list.reduce((n,r)=>n+r.amount,0);
   for(const r of [...list].sort((a,b)=>(b.mills%10)-(a.mills%10)))if(rest>0){r.amount++;rest--;}
   for(const r of list)amounts.set(r.id,{eventId:r.eventId,amount:r.amount});
 }
 return amounts;
}
export function paymentsForRows(state,rows){
  const output=new Map(),sourceMonths=new Map();
  for(const row of rows){
    if(row.type!=='expense'||['paid','covered','void'].includes(row.status)||row.sourceStatus==='Pago')continue;
    if(['source','source-projection'].includes(row.origin)){
      if(!sourceMonths.has(row.month))sourceMonths.set(row.month,sourceItemAmounts(state,row.month));
      const e=sourcePaymentEvent(state,row),amount=sourceMonths.get(row.month).get(row.id)?.amount;
      if(!e||!['planned','deferred'].includes(e.status)||e.itemPayments?.some(p=>p.key===row.id)||!amount||amount>outstandingAmount(e))continue;
      output.set(row.id,{id:row.id,eventId:e.id,item:true,amount,description:row.description,account:e.account,paymentMonth:e.date?e.date.slice(0,7):e.month});
    }else{
      const e=state.events.find(e=>e.id===(row.eventId||row.id));
      if(e?.direction==='out'&&['planned','deferred'].includes(e.status)&&outstandingAmount(e)>0)output.set(e.id,{...e,eventId:e.id,amount:outstandingAmount(e),item:false});
    }
  }
  return [...output.values()];
}
export function payExpenses(state,ids,month,date=todayBR()){
  if(!Array.isArray(ids)||!ids.length)throw new Error('Selecione pelo menos uma despesa pendente.');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date||'')||isNaN(Date.parse(date+'T12:00:00Z')))throw new Error('Data de pagamento inválida.');
  const eligible=new Map(paymentsForRows(state,ledgerForMonth(state,month)).map(e=>[e.id,e])),groups=new Map();
  for(const id of new Set(ids)){
    const entry=eligible.get(id);if(!entry)throw new Error('Uma despesa da seleção já foi paga ou não pode ser conciliada. Revise a seleção.');
    if(!groups.has(entry.eventId))groups.set(entry.eventId,[]);groups.get(entry.eventId).push(entry);
  }
  const sourceAmounts=sourceItemAmounts(state,month);
  for(const [id,entries] of groups){
    const e=state.events.find(e=>e.id===id);
    const known=[...sourceAmounts.values()].filter(r=>r.eventId===id).reduce((n,r)=>n+r.amount,0);
    if(entries.some(r=>r.item)&&known>e.amount)throw new Error('O valor da fatura é menor que a soma dos itens. Confira a fatura na Agenda antes de pagar os itens.');
    if(entries.reduce((n,r)=>n+r.amount,0)>outstandingAmount(e))throw new Error('Os itens ultrapassam o restante da fatura. Confira o valor na Agenda.');
  }
  const s=clone(state);
  for(const [id,entries] of groups){
    const e=s.events.find(e=>e.id===id),total=entries.reduce((n,r)=>n+r.amount,0);e.previousStatus=e.previousStatus||e.status;
    for(const item of entries.filter(r=>r.item)){e.itemPayments??=[];e.itemPayments.push({key:item.id,amount:item.amount,paidDate:date});}
    e.applied=(e.applied||0)-total;s.settings.balance-=total;
    if(entries.some(r=>!r.item)||outstandingAmount(e)===0){e.status='paid';e.paidDate=date;}
  }
  validateState(s);return s;
}
export function installmentDetails(state,row){
  let part=row.part,parts=row.parts;
  if(!part&&row.kind==='loan'){const match=String(row.description||'').match(/parcela\s+(\d+)\s*\/\s*(\d+)/i);if(match){part=Number(match[1]);parts=Number(match[2]);}}
  if(!part&&row.kind==='agreement'&&row.source==='source'){
    const source=state.history.find(r=>String(row.id||'').endsWith('-'+r.row)&&r.account===row.account&&r.description===row.description);
    if(source){part=source.part;parts=source.parts;}
  }
  if(!Number.isInteger(part)||!Number.isInteger(parts)||part<1||parts<=1||part>parts)return ['installments','agreement'].includes(row.kind)?{part:null,parts:null,grouped:true}:null;
  return {part,parts,grouped:false,settled:['paid','covered'].includes(row.status)||row.sourceStatus==='Pago',deferred:row.status==='deferred',unknown:!row.status&&!row.sourceStatus};
}
export function receiveEvents(state,ids,date=todayBR()){
  if(!Array.isArray(ids)||!ids.length)throw new Error('Selecione pelo menos uma entrada pendente.');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date||'')||isNaN(Date.parse(date+'T12:00:00Z')))throw new Error('Data de recebimento inválida.');
  const selected=new Set(ids),events=new Map(state.events.map(e=>[e.id,e]));
  for(const id of selected){const e=events.get(id);if(!e||e.direction!=='in'||e.status!=='planned')throw new Error('Uma entrada da seleção já foi conciliada ou não pode ser recebida. Revise a seleção.');}
  const s=clone(state);
  for(const e of s.events)if(selected.has(e.id)){e.previousStatus=e.status;e.status='paid';e.paidDate=date;e.applied=e.amount;s.settings.balance+=e.amount;}
  validateState(s);return s;
}
export function undoPurchase(state,id){const s=clone(state),p=s.purchases.find(p=>p.id===id);if(!p||p.void)throw new Error('Lançamento já desfeito.');const linked=s.events.filter(e=>e.purchaseId===id);if(linked.some(e=>['paid','covered'].includes(e.status)))throw new Error('Desfaça primeiro a conciliação dos pagamentos desta compra na Agenda.');p.void=true;for(const e of linked)e.status='void';if(['Pix','Dinheiro'].includes(p.payment))s.settings.balance+=p.amount;else if(['VR','VA'].includes(p.payment)&&s.settings.benefits[p.payment]!==null)s.settings.benefits[p.payment]+=p.amount;return s;}
export function validateState(s){
  if(!s||s.version!==1||!s.settings||!Array.isArray(s.events)||!Array.isArray(s.purchases)||!Array.isArray(s.history)||s.events.length>15000||s.purchases.length>10000)throw new Error('Backup ou controle inválido.');
  const cents=(n,nullable=false)=>{if(nullable&&n===null)return;if(!Number.isSafeInteger(n)||Math.abs(n)>1e11)throw new Error('Valor monetário inválido.');};
  const date=(d,blank=false)=>{if(blank&&d==='')return;if(typeof d!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(d)||isNaN(Date.parse(d+'T12:00:00Z')))throw new Error('Data inválida.');};
  cents(s.settings.balance);cents(s.settings.essentials,true);cents(s.settings.safety);cents(s.settings.monthlyLimit,true);if(s.settings.essentials<0||s.settings.safety<0||s.settings.monthlyLimit<0)throw new Error('Provisões devem ser positivas ou zero.');date(s.settings.asOf);
  if(!s.settings.benefits)throw new Error('Benefícios ausentes.');for(const n of Object.values(s.settings.benefits))cents(n,true);
  if(s.settings.cards!==undefined){
    if(!Array.isArray(s.settings.cards)||s.settings.cards.length>100)throw new Error('Cadastro de cartões inválido.');
    const cardIds=new Set();for(const c of s.settings.cards){if(!c||typeof c.id!=='string'||!/^[\p{L}\p{N}][\p{L}\p{N}:_-]{0,99}$/u.test(c.id)||!isCard(c.id)||cardIds.has(c.id)||typeof c.name!=='string'||!c.name.trim()||c.name.length>80||(c.dueDay!==null&&!validCardDay(c.dueDay))||(c.closingDay!==null&&!validCardDay(c.closingDay)))throw new Error('Confira nome, vencimento e fechamento dos cartões.');cardIds.add(c.id);}
  }
  const ids=new Set();for(const e of s.events){if(typeof e.id!=='string'||ids.has(e.id))throw new Error('Compromisso duplicado.');ids.add(e.id);cents(e.amount);if(e.amount<=0||!['in','out'].includes(e.direction)||!['planned','paid','covered','deferred','void'].includes(e.status))throw new Error('Compromisso inválido.');date(e.date,true);if(e.applied!==undefined)cents(e.applied);if(typeof e.description!=='string'||e.description.length>500)throw new Error('Descrição inválida.');}
  for(const e of s.events)if(e.recurrenceId!==undefined&&(typeof e.recurrenceId!=='string'||!e.recurrenceId.trim()||e.recurrenceId.length>100))throw new Error('Identificação de recorrência inválida.');
  const paymentKeys=new Set(),paymentMonths=new Map();for(const e of s.events)if(e.itemPayments!==undefined){
    if(e.direction!=='out'||!Array.isArray(e.itemPayments)||e.itemPayments.length>10000||e.status==='void')throw new Error('Pagamentos dos itens inválidos.');
    for(const p of e.itemPayments){
      if(!p||typeof p.key!=='string'||!p.key||paymentKeys.has(p.key))throw new Error('Pagamento de item duplicado.');paymentKeys.add(p.key);cents(p.amount);if(p.amount<=0)throw new Error('Pagamento de item inválido.');date(p.paidDate);
      const original=s.history.find(r=>r.id===p.key),projection=p.key.match(/^projection-(.+)-(\d{4}-\d{2})$/),month=original?.month||projection?.[2];
      if(!month)throw new Error('Pagamento sem item de origem.');
      if(!paymentMonths.has(month))paymentMonths.set(month,sourceItemAmounts(s,month));
      const canonical=paymentMonths.get(month).get(p.key);
      if(!canonical||canonical.eventId!==e.id||canonical.amount!==p.amount)throw new Error('Pagamento não corresponde ao item e à fatura de origem.');
    }
    const paid=itemPaidTotal(e),open=['planned','deferred'].includes(e.status);if(paid>e.amount||paid>-(e.applied||0)||Math.abs(e.applied||0)>e.amount||open&&(e.applied!==-paid||paid>=e.amount)||e.status==='covered'&&e.applied!==-paid||e.status==='paid'&&e.applied!==-e.amount)throw new Error('Pagamentos dos itens não conferem com a fatura.');
  }
  const purchases=new Set();for(const p of s.purchases){if(typeof p.id!=='string'||purchases.has(p.id))throw new Error('Lançamento duplicado.');purchases.add(p.id);cents(p.amount);date(p.date);if(p.amount<=0||![...PAYMENTS,...paymentOptions(s)].includes(p.payment)||typeof p.description!=='string'||p.description.length>500)throw new Error('Lançamento inválido.');if(p.split){const v=p.split;if(typeof v.person!=='string'||!v.person.trim()||v.person==='JEFFERSON'||v.person.length>80||!Number.isFinite(v.percent)||v.percent<0||v.percent>100||!Number.isSafeInteger(v.myAmount)||!Number.isSafeInteger(v.otherAmount)||v.myAmount<0||v.otherAmount<0||v.myAmount+v.otherAmount!==p.amount)throw new Error('Divisão inválida no backup.');}}
  return s;
}
export function addIncome(state,input){
  if(!Number.isSafeInteger(input.amount)||input.amount<=0||!input.description?.trim()||!/^\d{4}-\d{2}-\d{2}$/.test(input.date||''))throw new Error('Confira valor, descrição e data da receita.');
  if(state.events.some(e=>e.id===input.id))throw new Error('Receita já salva.');
  const s=clone(state);s.events.push({id:input.id,description:input.description.trim(),amount:input.amount,date:input.date,direction:'in',status:'planned',confirmed:true,source:'manual',kind:'income',category:input.category||'Renda',account:'Conta',person:'JEFFERSON'});
  return input.received?settleEvent(s,input.id,input.date):s;
}
export function ledgerForMonth(state,month,filters={}){
  const expenses=expensesForMonth(state,month),rows=[],combined=new Map();
  for(const r of expenses){
    const key=r.split?r.id:r.id||`source-${r.row}`;
    if(combined.has(key)){const t=combined.get(key);t.amount+=r.amount;t.shares[r.person]=(t.shares[r.person]||0)+r.amount;if(r.person==='JEFFERSON')t.myAmount+=r.amount;continue;}
    const t={...r,type:'expense',category:categoryName(r.category),amount:r.amount,myAmount:r.person==='JEFFERSON'?r.amount:0,shares:{[r.person]:r.amount},bank:paymentName(state,r.bankId||r.payment),isSplit:!!r.split,date:r.date||'',reimbursementId:r.purchaseId?`reimbursement-${r.purchaseId}`:undefined};
    combined.set(key,t);rows.push(t);
  }
  const sourceMonth=state.history.some(r=>r.month===month);
  for(const e of state.events){
    if(e.status==='void'||(e.date?e.date.slice(0,7):e.month)!==month||e.purchaseId&&e.direction==='out')continue;
    if(e.direction==='out'&&e.source==='source'&&['invoice','installments','settlement','agreement'].includes(e.kind)&&state.history.some(r=>r.type==='Cartão'&&r.account===e.account))continue;
    if(e.direction==='out'&&e.source==='source'&&sourceMonth&&['invoice','fixed','agreement','installments','settlement'].includes(e.kind))continue;
    const person=e.person||'JEFFERSON';
    rows.push({...e,eventId:e.id,origin:'event',type:e.direction==='in'?'income':'expense',category:e.kind==='reimbursement'?'Reembolso':categoryName(e.category||(e.direction==='in'?'Renda':e.kind==='loan'?'Empréstimos':'Contas')),payment:e.account||'Conta',bank:paymentName(state,e.account||'Conta'),myAmount:person==='JEFFERSON'&&e.direction==='out'?e.amount:0,shares:{[person]:e.amount},isSplit:false});
  }
  const query=searchable(filters.search||'');
  return rows.map(r=>({...r,displayAmount:filters.person&&r.shares[filters.person]!==undefined?r.shares[filters.person]:r.isSplit?r.myAmount:r.amount})).filter(r=>{
    const person=filters.person||'Todos';
    return (!filters.type||filters.type==='all'||r.type===filters.type)&&(!filters.category||filters.category==='ALL'||r.category===filters.category)
      &&(person==='Todos'||person==='ALL'||person==='DIVIDED_ALL'&&r.isSplit||person==='SINGLE_ONLY'&&!r.isSplit&&(r.person||'JEFFERSON')==='JEFFERSON'||Object.hasOwn(r.shares,person))
      &&(!query||searchable(`${r.description} ${r.category} ${r.bank} ${Object.keys(r.shares).join(' ')}`).includes(query));
  }).sort((a,b)=>(b.date||month+'-01').localeCompare(a.date||month+'-01'));
}

function detailExpenseRows(rows,total){
  const values=rows.map((row,index)=>{const mills=Math.round((row.originalAmount??row.amount/100)*1000);return {row,index,mills,amount:Math.floor(mills/10)};});
  let remaining=total-values.reduce((n,r)=>n+r.amount,0);
  for(const value of [...values].sort((a,b)=>(b.mills-b.amount*10)-(a.mills-a.amount*10)||a.index-b.index))if(remaining>0){value.amount++;remaining--;}
  return values.map(({row,amount})=>({...row,detailAmount:amount}));
}
export function cardExpenseDetails(state,month,cardId){
  const rows=ledgerForMonth(state,month,{type:'expense'}).filter(r=>r.payment===cardId&&!['VR','VA'].includes(r.payment)),amount=historyTotal(rows);
  return {title:paymentName(state,cardId),amount,rows:detailExpenseRows(rows,amount)};
}
export function analysisGroups(state,month,mode='category',person='JEFFERSON'){
  if(!['category','bank','person'].includes(mode))throw new Error('Agrupamento de análise inválido.');
  const rows=ledgerForMonth(state,month,{type:'expense',person:mode==='person'?'Todos':person}).filter(r=>!['VR','VA'].includes(r.payment));
  let selected;
  if(mode==='person')selected=rows.flatMap(r=>Object.entries(r.shares).filter(([,amount])=>amount!==0).map(([name,amount])=>({...r,expenseCategory:r.category,category:name,analysisPerson:name,amount,originalAmount:r.isSplit?undefined:r.originalAmount})));
  else selected=rows.filter(r=>mode!=='bank'||cardsForState(state).some(c=>c.id===r.payment)||r.bankId).map(r=>({...r,expenseCategory:r.category,category:mode==='bank'?r.bank:r.category,analysisPerson:!['Todos','ALL'].includes(person)?person:undefined,amount:['Todos','ALL'].includes(person)?r.amount:r.displayAmount,originalAmount:r.isSplit?undefined:r.originalAmount}));
  return groupExpenses(selected).map(g=>({...g,rows:detailExpenseRows(g.rows,g.amount)}));
}
export function monthOverview(state,month){
  const rows=ledgerForMonth(state,month),own=ledgerForMonth(state,month,{person:'JEFFERSON',type:'expense'}).filter(r=>!['VR','VA'].includes(r.payment));
  const certain=r=>['paid','covered'].includes(r.status)||r.confirmed===true&&!!r.date;
  const income=rows.filter(r=>r.type==='income'&&r.kind!=='reimbursement');
  const source=state.history.filter(r=>r.month===month);
  return {balance:state.settings.balance,income:income.filter(certain).reduce((n,r)=>n+r.amount,0),pendingIncome:income.filter(r=>!certain(r)).reduce((n,r)=>n+r.amount,0),
    personalExpenses:historyTotal(own.map(r=>({...r,amount:r.displayAmount,originalAmount:r.isSplit?undefined:r.originalAmount}))),
    sharedExpenses:historyTotal(rows.filter(r=>r.type==='expense'&&r.person==='Compartilhado')),
    sourceOwn:historyTotal(source.filter(r=>r.person==='JEFFERSON')),sourceAll:historyTotal(source),sourceCount:source.length,
    purchasesCount:state.purchases.filter(p=>!p.void&&p.date.startsWith(month)).length,
    projectedCount:expensesForMonth(state,month).filter(r=>r.origin==='source-projection').length};
}
export function inspectBackup(payload,fallbackMonth=todayBR().slice(0,7)){
  const state=clone(payload?.state||payload);validateState(state);
  const months=[...state.history.map(r=>r.month),...state.purchases.filter(p=>!p.void).map(p=>p.date.slice(0,7))].filter(m=>/^\d{4}-\d{2}$/.test(m||'')).sort();
  return {state,month:months.at(-1)||fallbackMonth,historyCount:state.history.length,eventsCount:state.events.length,purchasesCount:state.purchases.filter(p=>!p.void).length};
}

