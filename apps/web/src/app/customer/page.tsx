import {redirect} from 'next/navigation';
// Legacy customer entry: the booking flow lives under the localized public site.
export default function Customer() { redirect('/ja/book'); }
