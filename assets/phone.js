/* Shared local parser: no SMS, network requests or ownership verification.
 * Keep raw booking numbers; canonical identity is only for newly written rows. */
(function(root,factory){
  if(typeof module==='object'&&module.exports) module.exports=factory(require('libphonenumber-js/min'));
  else root.SussexPhone=factory(root.libphonenumber);
})(typeof window!=='undefined'?window:this,function(lib){
  function canonical(value,country='NL') {
    let text=String(value||'').trim().replace(/[٠-٩۰-۹]/g,c=>String(c.charCodeAt(0)-(c<='٩'?1632:1776)));
    if(!text || text.length>40 || !/^[+\d\s().-]+$/.test(text))return '';
    if(text.startsWith('00'))text='+'+text.slice(2);
    if(!lib || typeof country!=='string' || !lib.isSupportedCountry(country))return '';
    const p=lib.parsePhoneNumberFromString(text,{defaultCountry:country,extract:false});
    return p && !p.ext && p.isPossible() ? p.number : '';
  }
  // Legacy local numbers are only interpreted as Dutch when they have the
  // full ten-digit leading-zero form. Ambiguous numbers stay exact-only.
  function legacyVariants(e164){
    if(!e164)return [];
    const p=lib.parsePhoneNumberFromString(e164);
    const digits=e164.slice(1),result=[digits,'00'+digits];
    if(p&&p.country==='NL')result.push('0'+p.nationalNumber);
    return result;
  }
  function initialise(){
    if(!lib)return;
    document.querySelectorAll('select[data-phone-country]').forEach(select=>{
      if(select.dataset.ready)return;
      select.dataset.ready='true';
      const names=new Intl.DisplayNames([document.documentElement.lang==='nl'?'nl':'en'],{type:'region'});
      const countries=lib.getCountries().sort((a,b)=>names.of(a).localeCompare(names.of(b)));
      select.replaceChildren(...countries.map(country=>{
        const option=document.createElement('option');option.value=country;option.defaultSelected=country==='NL';
        option.textContent=names.of(country)+' (+'+lib.getCountryCallingCode(country)+')';return option;
      }));select.value='NL';
    });
  }
  if(typeof document!=='undefined'){
    document.addEventListener('DOMContentLoaded',initialise);
    if(document.readyState!=='loading')initialise();
  }
  return {canonical,legacyVariants};
});
