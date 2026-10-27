<?php
// CLI-only browser-test fixture. Never serves HTTP and refuses non-disposable databases.
$database=getenv('DB_DATABASE');
if(getenv('APP_ENV')!=='testing' || getenv('DB_CONNECTION')!=='sqlite' || !is_string($database) || (!str_starts_with($database,'/private/tmp/') && !str_starts_with($database,'/tmp/'))) { fwrite(STDERR,"Disposable test database required.\n");exit(1); }
require __DIR__.'/../../api/vendor/autoload.php';
$app=require __DIR__.'/../../api/bootstrap/app.php';$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
$v=json_decode($argv[1] ?? '{}',true,512,JSON_THROW_ON_ERROR);
$user=$v['user'] ?? Illuminate\Support\Facades\DB::table('users')->insertGetId(['name'=>$v['name'] ?? 'Browser tester','email'=>($v['email'] ?? Illuminate\Support\Str::uuid().'@example.test'),'password'=>'unused','email_verified_at'=>now(),'created_at'=>now(),'updated_at'=>now()]);
$site=$v['site'] ?? null;
if($site){ Illuminate\Support\Facades\DB::table('memberships')->insertOrIgnore(['site_id'=>$site,'user_id'=>$user,'role'=>$v['role'] ?? 'member','accepted_at'=>now()]); $p=App\Support\Accounts::participant($user,$site); }
$result=App\Support\Accounts::issue($user,$site,$v['origin'] ?? null);
$result['user']=Illuminate\Support\Facades\DB::table('users')->where('id',$user)->first(['id','name','email']);
if($site){$result['id']=$p->id;$result['name']=$p->name;$result['role']=$v['role'] ?? 'member';$result['user_id']=$user;}
if(!empty($v['magic'])){ $magic=Illuminate\Support\Str::random(64); Illuminate\Support\Facades\DB::table('login_links')->insert(['email'=>$result['user']->email,'token_hash'=>hash('sha256',$magic),'expires_at'=>now()->addMinutes(15),'created_at'=>now()]);$result['magic']=$magic; }
echo json_encode($result,JSON_THROW_ON_ERROR);
