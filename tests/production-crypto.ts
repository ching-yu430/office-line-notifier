// 本機 workerd 沒有完整套用正式環境的限制；測試明確補上單次 PBKDF2 100,000 上限。
export const productionCryptoLimit=`
const originalOfficeDeriveBits=crypto.subtle.deriveBits.bind(crypto.subtle);
crypto.subtle.deriveBits=async (algorithm,key,length)=>{
 if(algorithm?.name==='PBKDF2'&&algorithm.iterations>100000)throw new DOMException('Pbkdf2 failed: iteration counts above 100000 are not supported','NotSupportedError');
 return originalOfficeDeriveBits(algorithm,key,length);
};
`;
