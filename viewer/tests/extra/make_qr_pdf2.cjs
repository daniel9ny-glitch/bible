const {PDFDocument,StandardFonts}=require('pdf-lib');const QR=require('qrcode');const {PNG}=require('pngjs');const fs=require('fs');
(async()=>{
 const d=await PDFDocument.create();const f=await d.embedFont(StandardFonts.Helvetica);
 const p=d.addPage([1190,842]);
 // busy photo-like bg
 const W=600,H=424,png=new PNG({width:W,height:H});
 for(let y=0;y<H;y++)for(let x=0;x<W;x++){const i=(y*W+x)*4;const v=100+60*Math.sin(x/17)+50*Math.cos(y/11)+Math.random()*40;png.data[i]=v*.5;png.data[i+1]=v*.9;png.data[i+2]=v*.6;png.data[i+3]=255;}
 p.drawImage(await d.embedPng(PNG.sync.write(png)),{x:0,y:0,width:595,height:842});
 for(let i=0;i<40;i++)p.drawText('Right page body text lorem ipsum '+i,{x:640,y:800-i*18,size:10,font:f});
 const a=await d.embedPng(await QR.toBuffer('https://small.example.com/a',{width:200,margin:1}));
 const b=await d.embedPng(await QR.toBuffer('https://small.example.com/b',{width:200,margin:1}));
 p.drawImage(a,{x:1020,y:560,width:34,height:34});   // small QR on text page (about 2.9% of width)
 p.drawImage(b,{x:100,y:60,width:40,height:40});     // small QR over busy photo
 fs.writeFileSync('out/qr/qr2.pdf',await d.save());
})();
