/**
 * Adapta al español de Latinoamérica el texto que escriben los traductores automáticos, que
 * aprendieron sobre todo con español de España: «vosotros» pasa a «ustedes» (con sus verbos) y se
 * cambian las palabras que en Latinoamérica suenan raras o significan otra cosa. Solo se tocan
 * palabras sin otro sentido común en Latinoamérica; ante la duda, se deja el original.
 */

/** Frases hechas, antes de mirar palabra por palabra. */
const PHRASES: [RegExp, string][] = [
  [/carn[eé]t? de conducir/giu, "licencia de manejo"],
  [/daos prisa/giu, "apúrense"],
  [/date prisa/giu, "apúrate"],
  [/dese prisa/giu, "apúrese"],
  [/dense prisa/giu, "apúrense"],
];

const WORDS: Record<string, string> = {
  vosotros: "ustedes",
  vosotras: "ustedes",
  vuestro: "su",
  vuestra: "su",
  vuestros: "sus",
  vuestras: "sus",
  ordenador: "computadora",
  ordenadores: "computadoras",
  móvil: "celular",
  móviles: "celulares",
  zumo: "jugo",
  zumos: "jugos",
  gafas: "lentes",
  patata: "papa",
  patatas: "papas",
  melocotón: "durazno",
  melocotones: "duraznos",
  nevera: "refrigerador",
  neveras: "refrigeradores",
  frigorífico: "refrigerador",
  camarero: "mesero",
  camarera: "mesera",
  camareros: "meseros",
  camareras: "meseras",
  fontanero: "plomero",
  fontaneros: "plomeros",
  jersey: "suéter",
  jerséis: "suéteres",
  bocadillo: "sándwich",
  bocadillos: "sándwiches",
  vídeo: "video",
  vídeos: "videos",
  aparcar: "estacionar",
  aparcamiento: "estacionamiento",
  aparcado: "estacionado",
  enfadado: "enojado",
  enfadada: "enojada",
  enfadados: "enojados",
  enfadadas: "enojadas",
  enfadar: "enojar",
  enfadarse: "enojarse",
  enfada: "enoja",
  enfado: "enojo",
  guay: "genial",
  gilipollas: "idiota",
  // «Coger» es vulgar en México.
  coger: "tomar",
  cogerlo: "tomarlo",
  cogerla: "tomarla",
  cógelo: "tómalo",
  cógela: "tómala",
  cojo: "tomo",
  coges: "tomas",
  coge: "toma",
  cogemos: "tomamos",
  cogen: "toman",
  cogí: "tomé",
  cogiste: "tomaste",
  cogió: "tomó",
  cogieron: "tomaron",
  cogido: "tomado",
  cogiendo: "tomando",
  coged: "tomen",

  // Verbos con «vosotros» que cambian la raíz o son irregulares.
  sois: "son",
  seáis: "sean",
  erais: "eran",
  fuisteis: "fueron",
  vais: "van",
  vayáis: "vayan",
  ibais: "iban",
  estáis: "están",
  habéis: "han",
  hayáis: "hayan",
  dais: "dan",
  deis: "den",
  veis: "ven",
  oís: "oyen",
  tenéis: "tienen",
  queréis: "quieren",
  queráis: "quieran",
  podéis: "pueden",
  podáis: "puedan",
  entendéis: "entienden",
  entendáis: "entiendan",
  perdéis: "pierden",
  perdáis: "pierdan",
  volvéis: "vuelven",
  volváis: "vuelvan",
  movéis: "mueven",
  pensáis: "piensan",
  penséis: "piensen",
  contáis: "cuentan",
  contéis: "cuenten",
  encontráis: "encuentran",
  encontréis: "encuentren",
  empezáis: "empiezan",
  empecéis: "empiecen",
  comenzáis: "comienzan",
  jugáis: "juegan",
  juguéis: "jueguen",
  recordáis: "recuerdan",
  recordéis: "recuerden",
  cerráis: "cierran",
  cerréis: "cierren",
  probáis: "prueban",
  mostráis: "muestran",
  sentáis: "sientan",
  decís: "dicen",
  venís: "vienen",
  preferís: "prefieren",
  sentís: "sienten",
  dormís: "duermen",
  durmáis: "duerman",
  pedís: "piden",
  seguís: "siguen",
  conseguís: "consiguen",
  repetís: "repiten",
  servís: "sirven",
  morís: "mueren",
  mentís: "mienten",
  elegís: "eligen",
  // Presente de subjuntivo de verbos en -rar, que se confundirían con el futuro (esperaréis).
  esperéis: "esperen",
  preparéis: "preparen",
  separéis: "separen",
  comparéis: "comparen",
  paréis: "paren",
  declaréis: "declaren",
  disparéis: "disparen",
  reparéis: "reparen",
  aclaréis: "aclaren",
  consideréis: "consideren",
  recuperéis: "recuperen",
  operéis: "operen",
  toleréis: "toleren",
  miréis: "miren",
  tiréis: "tiren",
  giréis: "giren",
  retiréis: "retiren",
  respiréis: "respiren",

  // Imperativos.
  mirad: "miren",
  esperad: "esperen",
  venid: "vengan",
  escuchad: "escuchen",
  tened: "tengan",
  haced: "hagan",
  decid: "digan",
  dejad: "dejen",
  corred: "corran",
  parad: "paren",
  entrad: "entren",
  salid: "salgan",
  tomad: "tomen",
  comed: "coman",
  bebed: "beban",
  subid: "suban",
  bajad: "bajen",
  abrid: "abran",
  cerrad: "cierren",
  callad: "callen",
  seguid: "sigan",
  volved: "vuelvan",
  traed: "traigan",
  poned: "pongan",
  ayudad: "ayuden",
  disparad: "disparen",
  sentaos: "siéntense",
  callaos: "cállense",
  quedaos: "quédense",
  marchaos: "váyanse",
  idos: "váyanse",
  preparaos: "prepárense",
  calmaos: "cálmense",
  // Infinitivo con «os» pegado.
  deciros: "decirles",
  contaros: "contarles",
  ayudaros: "ayudarles",
  daros: "darles",
  pediros: "pedirles",
  enseñaros: "enseñarles",
  veros: "verlos",
};

/** Palabras que al cambiarlas cambian de género: el artículo de delante tiene que seguirlas. */
const GENDER_SWAP = /(\p{L}+)(\s+)(?=(?:ordenador(?:es)?|gafas|neveras?)(?!\p{L}))/giu;

const DETERMINERS: [string, string][] = [
  ["el", "la"], ["un", "una"], ["este", "esta"], ["ese", "esa"], ["aquel", "aquella"], ["nuestro", "nuestra"],
  ["los", "las"], ["unos", "unas"], ["estos", "estas"], ["esos", "esas"], ["aquellos", "aquellas"], ["nuestros", "nuestras"],
];
const SWAP = new Map([...DETERMINERS, ...DETERMINERS.map(([m, f]) => [f, m] as [string, string]), ["del", "de la"], ["al", "a la"]]);

/** Palabras con terminación de verbo que no lo son. */
const NOT_VERBS = new Set(["país", "anís", "cutís", "maís", "parís", "luís", "dieciséis", "dieciseis", "veintiséis", "veintiseis", "dubáis"]);

/** «Vosotros» de los verbos regulares, por la terminación. */
function regularVerb(w: string): string | null {
  if (w.length < 4 || NOT_VERBS.has(w)) return null;
  if (w.endsWith("asteis")) return w.slice(0, -6) + "aron";
  if (w.endsWith("ísteis")) return w.slice(0, -6) + "yeron"; // leísteis → leyeron
  if (w.endsWith("jisteis")) return w.slice(0, -6) + "eron"; // dijisteis → dijeron
  if (w.endsWith("isteis")) return w.slice(0, -6) + "ieron";
  if (/(?:b|r|í)ais$/u.test(w)) return w.slice(0, -3) + "an"; // hablabais, comíais, tuvierais
  if (w.endsWith("seis") && w.length >= 7) return w.slice(0, -3) + "en"; // tuvieseis
  if (/(?:[aei]r|dr|br|rr)éis$/u.test(w)) return w.slice(0, -3) + "án"; // futuro: tendréis
  if (w.endsWith("áis")) return w.slice(0, -3) + "an";
  if (w.endsWith("éis")) return w.slice(0, -3) + "en";
  if (w.endsWith("ís")) return w.slice(0, -2) + "en"; // vivís
  return null;
}

/** Verbos tras «os» que piden «los» y no «les» (os quiero → los quiero). */
const DIRECT_OBJECT = /^(?:quier|quer|ve[oíaso]|vi|conoc|conozc|esper|llam|necesit|am[oéa]|odi|invit|llev|busc|mat|proteg|protej|salv|extra|ech)/u;

function matchCase(src: string, repl: string): string {
  if (src.length > 1 && src === src.toUpperCase()) return repl.toUpperCase();
  if (src[0] !== src[0].toLowerCase()) return repl[0].toUpperCase() + repl.slice(1);
  return repl;
}

const WORD = /\p{L}+/gu;

export function latinize(text: string): string {
  let out = text;
  for (const [re, repl] of PHRASES) out = out.replace(re, (m) => matchCase(m, repl));
  out = out.replace(GENDER_SWAP, (m, det: string, space: string) => {
    const repl = SWAP.get(det.toLowerCase());
    return repl ? matchCase(det, repl) + space : m;
  });
  // «de la nevera» → «del refrigerador».
  out = out.replace(/(?<!\p{L})(d|D)e el(?=\s+nevera(?!\p{L}))/gu, "$1el").replace(/(?<!\p{L})(a|A) el(?=\s+nevera(?!\p{L}))/gu, "$1l");
  // «Vale» como respuesta, no «vale la pena».
  out = out.replace(/(^|[¡¿.!?]\s*)(vale)(?=\s*[,.!?]|$)/giu, (_, pre: string, w: string) => pre + matchCase(w, "está bien"));
  out = out.replace(WORD, (w, at: number) => {
    const lower = w.toLowerCase();
    if (lower === "os" && w !== "OS") {
      const next = out.slice(at + w.length).match(/^\s+(\p{L}+)/u)?.[1].toLowerCase() ?? "";
      const repl = /^l[oa]s?$/u.test(next) ? "se" : DIRECT_OBJECT.test(next) ? "los" : "les";
      return matchCase(w, repl);
    }
    const repl = WORDS[lower] ?? regularVerb(lower);
    return repl ? matchCase(w, repl) : w;
  });
  return out;
}
