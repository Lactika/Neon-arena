import {build} from 'esbuild';
import {readFile,writeFile} from 'node:fs/promises';
const result=await build({entryPoints:['client.js'],bundle:true,minify:true,write:false});
let js=result.outputFiles[0].text.replace(/<\/script/gi,'<\\/script');
let html=await readFile('template.html','utf8');
await writeFile('index.html',html.replace('<!-- APP_SCRIPT -->',()=>'<script>'+js+'</script>'));
console.log('Built self-contained index.html');
