import { useEffect, useState } from 'react';

export type Language = 'en' | 'th';
const KEY = 'grc:language';
let language: Language = (() => {
  try {
    return localStorage.getItem(KEY) === 'th' ? 'th' : 'en';
  } catch {
    return 'en';
  }
})();

export function setLanguage(next: Language): void {
  language = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* Settings remain in the database. */
  }
  window.dispatchEvent(new Event('grc-language'));
}

export function useLanguage(): Language {
  const [value, setValue] = useState(language);
  useEffect(() => {
    const update = () => setValue(language);
    window.addEventListener('grc-language', update);
    return () => window.removeEventListener('grc-language', update);
  }, []);
  return value;
}

export const tr = (english: string, thai: string): string =>
  language === 'th' ? thai : english;

export function localizeError(message: string): string {
  if (/rate limit/i.test(message))
    return tr(message, 'GitHub จำกัดจำนวนคำขอชั่วคราว กรุณาลองใหม่ภายหลัง');
  if (/401|rejected the token/i.test(message))
    return tr(message, 'GitHub ปฏิเสธ token กรุณาตรวจสอบการเชื่อมต่อ');
  if (/403|permission|access denied/i.test(message))
    return tr(message, 'สิทธิ์ไม่เพียงพอ กรุณาตรวจสอบสิทธิ์ของ token และเครื่อง');
  if (/404|not found/i.test(message))
    return tr(message, 'ไม่พบข้อมูลที่ต้องการ กรุณาตรวจ target และสิทธิ์');
  if (/network|ENOTFOUND|ECONN|ETIMEDOUT|fetch failed/i.test(message))
    return tr(message, 'เชื่อมต่อเครือข่ายไม่สำเร็จ กรุณาตรวจการเชื่อมต่อ');
  if (/running a job|busy/i.test(message))
    return tr(message, 'Runner กำลังทำงานอยู่ กรุณารอหรือเลือกข้าม');
  if (/cancel/i.test(message)) return tr(message, 'ยกเลิกการดำเนินการแล้ว');
  return tr(message, `เกิดข้อผิดพลาด: ${message}`);
}
