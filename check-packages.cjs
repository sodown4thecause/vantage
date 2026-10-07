const fs=require('fs'),path=require('path');let bad=[];
function walk(p){for(const e of fs.readdirSync(p,{withFileTypes:true})){const q=path.join(p,e.name);if(e.isDirectory())walk(q);else if(e.name==='package.json'){try{JSON.parse(fs.readFileSync(q,'utf8'))}catch{bad.push(q)}}}}
walk('node_modules/.pnpm');console.log(JSON.stringify(bad));
