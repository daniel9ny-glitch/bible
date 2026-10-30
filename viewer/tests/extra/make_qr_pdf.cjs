const {PDFDocument,rgb,StandardFonts}=require('pdf-lib');const QR=require('qrcode');const fs=require('fs');
(async()=>{
 const d=await PDFDocument.create();const f=await d.embedFont(StandardFonts.Helvetica);
 // p1 text only
 let p=d.addPage([595,842]);for(let i=0;i<30;i++)p.drawText('Plain text line '+i+' lorem ipsum dolor sit amet',{x:50,y:800-i*20,size:11,font:f});
 // p2 two raster QRs
 p=d.addPage([595,842]);p.drawText('raster qrs',{x:50,y:800,size:14,font:f});
 const a=await d.embedPng(await QR.toBuffer('https://example.com/neul-one',{width:300,margin:2}));
 const b=await d.embedPng(await QR.toBuffer('https://example.org/two',{width:240,margin:2}));
 p.drawImage(a,{x:80,y:500,width:150,height:150});p.drawImage(b,{x:350,y:200,width:100,height:100});
 // p3 vector QR
 p=d.addPage([595,842]);p.drawText('vector qr',{x:50,y:800,size:14,font:f});
 const q=QR.create('https://example.net/vec',{errorCorrectionLevel:'M'});const n=q.modules.size,m=5,ox=200,oy=300;
 p.drawRectangle({x:ox-20,y:oy-20,width:n*m+40,height:n*m+40,color:rgb(1,1,1)});
 for(let y=0;y<n;y++)for(let x=0;x<n;x++)if(q.modules.get(x,y))p.drawRectangle({x:ox+x*m,y:oy+(n-1-y)*m,width:m,height:m,color:rgb(0,0,0)});
 // p4 non-url QR
 p=d.addPage([595,842]);const c=await d.embedPng(await QR.toBuffer('just some text 123',{width:300,margin:2}));p.drawImage(c,{x:200,y:400,width:150,height:150});
 fs.writeFileSync('out/qr/qr.pdf',await d.save());
})();
