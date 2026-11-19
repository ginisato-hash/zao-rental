import {StaffSettings} from '../../../components/StaffSettings';
import {staffShellProps} from '../../../lib/staff-shell-props';
export const dynamic='force-dynamic';
export default async function Page(){
 const {locale,shell}=await staffShellProps();
 if(!shell)return <main><h1>{locale==='en'?'Sign-in required':'ログインが必要です'}</h1><a href="/staff/login">{locale==='en'?'Staff sign-in':'スタッフログインへ'}</a></main>;
 return <StaffSettings locale={locale} stamp={shell.stamp} access={shell.access}/>;
}
