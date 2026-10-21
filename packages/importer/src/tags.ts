import type { TagKind } from './types.ts';

const BATTLES = [
  'badr', 'uhud', 'khandaq', 'hunayn', 'hunain', 'yamamah', 'yamama', 'yarmuk', 'yarmouk',
  'qadisiyyah', 'qadisiya', 'siffin', 'camel', 'tabuk', 'khaybar', "mu'tah", 'mutah',
  'nahrawan', 'ajnadayn', 'karbala', 'hudaybiyyah', 'hudaybiyya',
];

const TRIBES = ['quraysh', 'quraish', 'aws', 'khazraj', 'tamim', 'kinda', 'hashim', 'umayyah', 'makhzum'];

export function tagKind(name: string): TagKind {
  const value = name.trim();
  const lower = value.toLowerCase();
  if (/^(female|male|woman)$/i.test(value)) return 'gender';
  if (/^(b\.|banu\b|bani\b|binu\b)/i.test(value)) return 'clan';
  if (BATTLES.includes(lower) || /^battle of\b/i.test(value)) return 'battle';
  if (TRIBES.includes(lower)) return 'tribe';
  if (/\b(century|generation|companion|sahabi|tabi|khalif)/i.test(value)) return 'era';
  if (/^[A-Z][\p{L}'-]{2,14}i$/u.test(value)) return 'nisba';
  return 'other';
}
