import {redirect} from 'next/navigation';
// The development shell is retired: the origin root leads to the public Japanese site. Staff sign in from /staff/login.
export default function Home() { redirect('/ja'); }
