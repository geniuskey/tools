// Google 태그 초기화. CSP 가 인라인 스크립트를 막으므로 app.html 에 직접 적지 않고 파일로 둔다.
window.dataLayer = window.dataLayer || [];
function gtag() {
  dataLayer.push(arguments);
}
gtag('js', new Date());
