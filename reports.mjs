import {analysisGroups,installmentDetails,money} from './finance.mjs';

const modeNames={category:'Categoria',bank:'Cartão/Banco',person:'Por pessoa'};
export function buildAnalysisReport(state,month,mode,person){
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw new Error('Selecione um mês válido.');
 const groups=analysisGroups(state,month,mode,person);
 return {month,period:new Intl.DateTimeFormat('pt-BR',{month:'long',year:'numeric'}).format(new Date(month+'-01T12:00:00Z')),mode,grouping:modeNames[mode],person:mode==='person'?'Todos':person,total:groups.reduce((n,g)=>n+g.amount,0),groups:groups.map(g=>({name:g.category,amount:g.amount})),rows:groups.flatMap(g=>g.rows.map(row=>{
   const part=installmentDetails(state,row),paid=['paid','covered'].includes(row.status)||row.sourceStatus==='Pago';
   return {group:g.category,date:row.date||row.month||month,description:row.description||'Despesa',person:row.analysisPerson||(row.isSplit?Object.keys(row.shares).filter(p=>row.shares[p]!==0).join(' + '):row.person||'JEFFERSON'),bank:row.bank||row.payment,category:row.expenseCategory||row.category,installment:part&&!part.grouped?`${part.part}/${part.parts}`:'',status:paid?'Paga':row.status==='deferred'?'Adiada':row.projection?'Prevista':row.status==='planned'||row.sourceStatus==='Aberto'?'A pagar':'Registrada',amount:row.detailAmount};
 }))};
}
export const reportFilename=(report,ext)=>`despesas-${report.month}-${report.mode}-${report.person.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9_-]+/g,'-').slice(0,60)}.${ext}`;
export const reportNote='Despesas do período, incluindo pagas e previstas. Valores das partes selecionadas; benefícios restritos fora do orçamento. Este relatório não representa o saldo da conta.';

export async function excelReport(report,ExcelJS){
 const wb=new ExcelJS.Workbook();wb.creator='JLC';wb.title='Relatório de despesas';
 const summary=wb.addWorksheet('Resumo'),items=wb.addWorksheet('Itens');
 summary.columns=[{width:42},{width:22}];items.columns=[{width:24},{width:15},{width:46},{width:25},{width:24},{width:24},{width:12},{width:15},{width:19}];
 const title=(sheet,last)=>{sheet.mergeCells(1,1,1,last);sheet.getCell('A1').value='Meu dinheiro | Relatório de despesas';sheet.getRow(1).height=30;sheet.getCell('A1').font={size:16,bold:true,color:{argb:'FF17365D'}};sheet.mergeCells(2,1,2,last);sheet.getCell('A2').value=`${report.period} | Pessoa: ${report.person} | ${report.grouping}`;sheet.getRow(2).height=32;sheet.getCell('A2').alignment={wrapText:true,vertical:'middle'};};
 title(summary,2);title(items,9);
 items.getRow(4).values=['Grupo','Data / competência','Descrição','Pessoa / parte','Cartão / banco','Categoria','Parcela','Situação','Valor (R$)'];
 const ranges=new Map();
 for(const row of report.rows){const n=items.rowCount+1;items.addRow([row.group,row.date,row.description,row.person,row.bank,row.category,row.installment,row.status,row.amount/100]);if(!ranges.has(row.group))ranges.set(row.group,[n,n]);ranges.get(row.group)[1]=n;items.getRow(n).height=Math.max(32,Math.ceil(row.description.length/42)*15,Math.ceil(row.person.length/23)*15,Math.ceil(row.bank.length/22)*15,Math.ceil(row.group.length/22)*15,Math.ceil(row.category.length/22)*15);}
 const last=items.rowCount;const totalRow=items.addRow(['Total','','','','','','','',{formula:last>=5?`SUM(I5:I${last})`:'0',result:report.total/100}]);totalRow.font={bold:true};
 summary.getCell('A4').value='Total das despesas (R$)';summary.getCell('B4').value={formula:report.groups.length?`SUM(B8:B${7+report.groups.length})`:'0',result:report.total/100};summary.getRow(4).font={bold:true,size:13};
 summary.getRow(7).values=[report.grouping,'Valor (R$)'];
 for(const g of report.groups){const [start,end]=ranges.get(g.name);const row=summary.addRow([g.name,{formula:`SUM(Itens!I${start}:I${end})`,result:g.amount/100}]);row.height=Math.max(25,Math.ceil(g.name.length/38)*15);}
 const noteRow=summary.rowCount+3;summary.mergeCells(noteRow,1,noteRow+2,2);summary.getCell(noteRow,1).value=reportNote;summary.getCell(noteRow,1).alignment={wrapText:true,vertical:'top'};summary.getCell(noteRow,1).font={size:10,color:{argb:'FF666666'}};
 for(const [sheet,head,lastCol] of [[summary,7,2],[items,4,9]]){
   sheet.views=[{state:'frozen',ySplit:head}];sheet.pageSetup={paperSize:9,orientation:'landscape',fitToPage:true,fitToWidth:1,fitToHeight:0,printTitlesRow:`1:${head}`};sheet.headerFooter.oddFooter='&CDesenvolvido por JLC | Página &P de &N';
   sheet.eachRow(row=>row.eachCell(cell=>{cell.alignment={...cell.alignment,vertical:'middle',wrapText:true};if(row.number>head&&row.number<=(sheet===items?totalRow.number:7+report.groups.length)){cell.font={size:11,...cell.font};if(row.number%2===0)cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFF1F5F9'}};}}));
   const header=sheet.getRow(head);header.height=30;for(let c=1;c<=lastCol;c++){header.getCell(c).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF17365D'}};header.getCell(c).font={bold:true,color:{argb:'FFFFFFFF'},size:11};}
 }
 summary.getColumn(2).numFmt='"R$" #,##0.00';items.getColumn(9).numFmt='"R$" #,##0.00';items.autoFilter={from:'A4',to:`I${Math.max(4,last)}`};
 return wb.xlsx.writeBuffer();
}

export function pdfReport(report,JsPDF){
 const doc=new JsPDF({unit:'mm',format:'a4',compress:true});doc.setProperties({title:`Despesas - ${report.period}`,author:'JLC'});
 const left=16,right=194,width=178;let y=0;
 const clean=v=>String(v??'').replace(/[\u0000-\u001f]/g,' ').replace(/[\u2010-\u2015]/g,'-');
 const wrap=(text,w,size=9,bold=false)=>{doc.setFont('helvetica',bold?'bold':'normal');doc.setFontSize(size);return doc.splitTextToSize(clean(text),w);};
 const text=(lines,x,top,size=9,bold=false,color=[35,45,60],options={})=>{doc.setFont('helvetica',bold?'bold':'normal');doc.setFontSize(size);doc.setTextColor(...color);doc.text(lines,x,top,options);};
 const header=()=>{doc.setFillColor(23,54,93);doc.rect(0,0,210,38,'F');text('Meu dinheiro | Relatório de despesas',left,15,15,true,[255,255,255]);const filters=wrap(`${report.period} | Pessoa: ${report.person} | ${report.grouping}`,width,9);text(filters,left,23,9,false,[220,232,248]);y=Math.max(47,27+filters.length*4);};
 const room=height=>{if(y+height>278){doc.addPage();header();}};
 const rule=()=>{doc.setDrawColor(220,226,234);doc.line(left,y,right,y);};
 header();text('TOTAL DO PERÍODO',left,y,9,true,[85,100,120]);text(money(report.total),right,y,16,true,[23,54,93],{align:'right'});y+=10;
 text('Resumo por '+report.grouping.toLowerCase(),left,y,11,true);y+=7;
 for(const group of report.groups){const lines=wrap(group.name,135,10);room(lines.length*4.2+4);text(lines,left,y,10);text(money(group.amount),right,y,10,true,undefined,{align:'right'});y+=lines.length*4.2+4;}
 if(!report.rows.length){text('Nenhuma despesa nos filtros selecionados.',left,y,10);y+=10;}
 y+=4;room(16);text('Itens do relatório',left,y,12,true);y+=8;
 for(const row of report.rows){
   const title=wrap(row.description,135,10,true),meta=wrap(`${row.date} | ${row.person} | ${row.bank} | ${row.category}${row.installment?' | Parcela '+row.installment:''} | ${row.status}`,width,8),group=wrap('Grupo: '+row.group,width,8);
   const height=title.length*4.2+(meta.length+group.length)*3.5+8;room(height);text(title,left,y,10,true);text(money(row.amount),right,y,10,true,undefined,{align:'right'});y+=title.length*4.2+1;text(meta,left,y,8,false,[85,100,120]);y+=meta.length*3.5;text(group,left,y,8,false,[85,100,120]);y+=group.length*3.5+3;rule();y+=4;
 }
 const notes=wrap(reportNote,width,8);room(notes.length*3.5+12);y+=5;text(notes,left,y,8,false,[85,100,120]);
 const count=doc.getNumberOfPages();for(let page=1;page<=count;page++){doc.setPage(page);text(`Desenvolvido por JLC | ${report.month}`,left,288,8,false,[100,110,125]);text(`${page} / ${count}`,right,288,8,false,[100,110,125],{align:'right'});}
 return new Uint8Array(doc.output('arraybuffer'));
}
