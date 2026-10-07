const fs=require('fs'),cp=require('child_process'),crypto=require('crypto');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const journal=JSON.parse(fs.readFileSync('drizzle/meta/_journal.json'));
console.log(JSON.stringify(journal.entries.slice(11).map(e=>{const p='drizzle/'+e.tag+'.sql',b=fs.readFileSync(p),blob=cp.execFileSync('git',['show','HEAD:'+p]);return {tag:e.tag,when:e.when,fileHash:hash(b),blobHash:hash(blob),lfHash:hash(b.toString().replace(/\r\n/g,'\n'))}})));
