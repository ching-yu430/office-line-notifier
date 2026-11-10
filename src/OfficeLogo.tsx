import logoUrl from './assets/npust-language-center-original.png';

// 直接使用語言中心的原始透明 PNG；不重繪、不變色、不加背景。
export function OfficeLogo(){
 return <img className="office-logo" src={logoUrl} alt="NPUST 辦公室標誌" width={63} height={40} />;
}
