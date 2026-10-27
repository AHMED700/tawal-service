import './style.css';
export const metadata = {
  title: 'توال العالمية | إدارة صيانة المكيفات',
  description: 'نظام بلاغات صيانة مكيفات المدارس',
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body>
        <header>
          <div className="wrap">
            <strong>
              توال العالمية <span>TAWAL International</span>
            </strong>
            <nav>
              <a href="/">بلاغ مدرسة</a>
              <a href="/login">دخول الموظفين</a>
            </nav>
          </div>
        </header>
        {children}
        <footer>توال العالمية — نظام إدارة صيانة المكيفات</footer>
      </body>
    </html>
  );
}
