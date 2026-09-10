import Link from 'next/link';
export default function Home() {
  return <main>
    <p className="eyebrow">ZAO RENTAL / DEVELOPMENT</p>
    <h1>蔵王のレンタルを、<br />ひとつの仕組みへ。</h1>
    <p className="intro">この画面は開発用の基盤です。予約受付はまだ開始していません。</p>
    <section aria-label="開発状況"><span className="badge">基盤を構築中</span>
      <h2>現在の公開範囲</h2><p>予約・在庫・料金・決済機能は準備中です。</p>
      <p>スタッフと管理者の操作は、認証機能の整備後に利用できます。</p>
    </section>
    <nav aria-label="利用区分"><Link href="/customer">お客様</Link><Link href="/staff">スタッフ</Link><Link href="/admin">管理者</Link></nav>
    <footer>ZAO Rental · 非公開開発版</footer>
  </main>;
}
