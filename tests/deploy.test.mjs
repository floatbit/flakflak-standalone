import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync,execFileSync} from 'node:child_process';
const php=process.env.FLAKFLAK_PHP_BIN || (fs.existsSync('/Applications/MAMP/bin/php/php8.2.0/bin/php')?'/Applications/MAMP/bin/php/php8.2.0/bin/php':'php');
const composer=execFileSync('which',['composer'],{encoding:'utf8'}).trim();
test('deployment validates configuration without publishing or running migrations',()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'flakflak-deploy-check-'));
 try{
  fs.mkdirSync(path.join(directory,'shared'));fs.writeFileSync(path.join(directory,'shared/api.env'),'APP_ENV=production\n');
  const config=path.join(directory,'config');
  const content=`DEPLOY_ROOT=${directory}\nAPI_PUBLIC=${directory}/api/public\nAPP_PUBLIC=${directory}/app/public\nEMBED_PUBLIC=${directory}/embed/public\nAPI_HEALTH_URL=https://api.example.test/api/v1/health\nVITE_API_URL=https://api.example.test/api/v1\nVITE_EMBED_URL=https://embed.example.test/widget.js\nPHP_BIN=${php}\nCOMPOSER_BIN=${composer}\n`;
  fs.writeFileSync(config,content);
  const invoke=()=>spawnSync('bash',['deploy.sh','--check'],{encoding:'utf8',env:{...process.env,FLAKFLAK_DEPLOY_CONFIG:config}});
  const good=invoke();assert.equal(good.status,0,good.stderr);assert.equal(fs.existsSync(path.join(directory,'releases')),false);
  fs.writeFileSync(config,content.replace('/api/public','/api/unsafe'));assert.notEqual(invoke().status,0);
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
