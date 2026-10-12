// Standalone preview data, copied from release character-creation.ts and equipment-v1.json.
// All people, campaigns and prepared heroes in this preview are synthetic.
export const STATS = [
  "INT",
  "REF",
  "TECH",
  "COOL",
  "ATTR",
  "LUCK",
  "MA",
  "BODY",
  "EMP"
];
export const STAT_LABELS = {
  "INT": "Интеллект",
  "REF": "Рефлексы",
  "TECH": "Техника",
  "COOL": "Самообладание",
  "ATTR": "Привлекательность",
  "LUCK": "Удача",
  "MA": "Движение",
  "BODY": "Телосложение",
  "EMP": "Эмпатия"
};
export const CORE_SKILLS = [
  {
    "id": "grooming",
    "name": "Уход за собой",
    "english": "Personal Grooming",
    "stat": "ATTR",
    "multiplier": 1
  },
  {
    "id": "style",
    "name": "Гардероб и стиль",
    "english": "Wardrobe & Style",
    "stat": "ATTR",
    "multiplier": 1
  },
  {
    "id": "endurance",
    "name": "Выносливость",
    "english": "Endurance",
    "stat": "BODY",
    "multiplier": 1
  },
  {
    "id": "strength",
    "name": "Силовое усилие",
    "english": "Strength Feat",
    "stat": "BODY",
    "multiplier": 1
  },
  {
    "id": "swimming",
    "name": "Плавание",
    "english": "Swimming",
    "stat": "BODY",
    "multiplier": 1
  },
  {
    "id": "interrogation",
    "name": "Допрос",
    "english": "Interrogation",
    "stat": "COOL",
    "multiplier": 1
  },
  {
    "id": "intimidate",
    "name": "Устрашение",
    "english": "Intimidate",
    "stat": "COOL",
    "multiplier": 1
  },
  {
    "id": "oratory",
    "name": "Ораторское искусство",
    "english": "Oratory",
    "stat": "COOL",
    "multiplier": 1
  },
  {
    "id": "resist",
    "name": "Сопротивление пыткам и наркотикам",
    "english": "Resist Torture/Drugs",
    "stat": "COOL",
    "multiplier": 1
  },
  {
    "id": "streetwise",
    "name": "Знание улицы",
    "english": "Streetwise",
    "stat": "COOL",
    "multiplier": 1
  },
  {
    "id": "perception",
    "name": "Понимание людей",
    "english": "Human Perception",
    "stat": "EMP",
    "multiplier": 1
  },
  {
    "id": "interview",
    "name": "Интервью",
    "english": "Interview",
    "stat": "EMP",
    "multiplier": 1
  },
  {
    "id": "leadership",
    "name": "Лидерство",
    "english": "Leadership",
    "stat": "EMP",
    "multiplier": 1
  },
  {
    "id": "seduction",
    "name": "Соблазнение",
    "english": "Seduction",
    "stat": "EMP",
    "multiplier": 1
  },
  {
    "id": "social",
    "name": "Этикет",
    "english": "Social",
    "stat": "EMP",
    "multiplier": 1
  },
  {
    "id": "persuasion",
    "name": "Убеждение",
    "english": "Persuasion & Fast Talk",
    "stat": "EMP",
    "multiplier": 1
  },
  {
    "id": "perform",
    "name": "Выступление",
    "english": "Perform",
    "stat": "EMP",
    "multiplier": 1
  },
  {
    "id": "accounting",
    "name": "Бухгалтерия",
    "english": "Accounting",
    "stat": "INT",
    "multiplier": 1
  },
  {
    "id": "anthropology",
    "name": "Антропология",
    "english": "Anthropology",
    "stat": "INT",
    "multiplier": 1
  },
  {
    "id": "notice",
    "name": "Внимательность",
    "english": "Awareness/Notice",
    "stat": "INT",
    "multiplier": 1
  },
  {
    "id": "biology",
    "name": "Биология",
    "english": "Biology",
    "stat": "INT",
    "multiplier": 1
  },
  {
    "id": "botany",
    "name": "Ботаника",
    "english": "Botany",
    "stat": "INT",
    "multiplier": 1
  },
  {
    "id": "chemistry",
    "name": "Химия",
    "english": "Chemistry",
    "stat": "INT",
    "multiplier": 1
  },
  {
    "id": "composition",
    "name": "Сочинительство",
    "english": "Composition",
    "stat": "INT",
    "multiplier": 1
  },
  {
    "id": "diagnose",
    "name": "Диагностика болезней",
    "english": "Diagnose Illness",
    "stat": "INT",
    "multiplier": 1
  },
  {
    "id": "education",
    "name": "Образование и общие знания",
    "english": "Education & General Knowledge",
    "stat": "INT",
    "multiplier": 1
  },
  {
    "id": "expert",
    "name": "Экспертные знания",
    "english": "Expert",
    "stat": "INT",
    "multiplier": 1,
    "detailLabel": "Область знаний"
  },
  {
    "id": "gamble",
    "name": "Азартные игры",
    "english": "Gamble",
    "stat": "INT",
    "multiplier": 1
  },
  {
    "id": "geology",
    "name": "Геология",
    "english": "Geology",
    "stat": "INT",
    "multiplier": 1
  },
  {
    "id": "evade",
    "name": "Скрыть следы",
    "english": "Hide/Evade",
    "stat": "INT",
    "multiplier": 1
  },
  {
    "id": "history",
    "name": "История",
    "english": "History",
    "stat": "INT",
    "multiplier": 1
  },
  {
    "id": "language",
    "name": "Язык",
    "english": "Know Language",
    "stat": "INT",
    "multiplier": 1,
    "detailLabel": "Какой язык"
  },
  {
    "id": "library",
    "name": "Поиск информации",
    "english": "Library Search",
    "stat": "INT",
    "multiplier": 1
  },
  {
    "id": "mathematics",
    "name": "Математика",
    "english": "Mathematics",
    "stat": "INT",
    "multiplier": 1
  },
  {
    "id": "physics",
    "name": "Физика",
    "english": "Physics",
    "stat": "INT",
    "multiplier": 1
  },
  {
    "id": "programming",
    "name": "Программирование",
    "english": "Programming",
    "stat": "INT",
    "multiplier": 1
  },
  {
    "id": "tracking",
    "name": "Выслеживание",
    "english": "Shadow/Track",
    "stat": "INT",
    "multiplier": 1
  },
  {
    "id": "stocks",
    "name": "Фондовый рынок",
    "english": "Stock Market",
    "stat": "INT",
    "multiplier": 1
  },
  {
    "id": "systems",
    "name": "Знание систем Сети",
    "english": "System Knowledge",
    "stat": "INT",
    "multiplier": 1
  },
  {
    "id": "teaching",
    "name": "Обучение",
    "english": "Teaching",
    "stat": "INT",
    "multiplier": 1
  },
  {
    "id": "survival",
    "name": "Выживание в дикой местности",
    "english": "Wilderness Survival",
    "stat": "INT",
    "multiplier": 1
  },
  {
    "id": "zoology",
    "name": "Зоология",
    "english": "Zoology",
    "stat": "INT",
    "multiplier": 1
  },
  {
    "id": "archery",
    "name": "Стрельба из лука",
    "english": "Archery",
    "stat": "REF",
    "multiplier": 1
  },
  {
    "id": "athletics",
    "name": "Атлетика",
    "english": "Athletics",
    "stat": "REF",
    "multiplier": 1
  },
  {
    "id": "brawling",
    "name": "Драка",
    "english": "Brawling",
    "stat": "REF",
    "multiplier": 1
  },
  {
    "id": "dance",
    "name": "Танец",
    "english": "Dance",
    "stat": "REF",
    "multiplier": 1
  },
  {
    "id": "dodge",
    "name": "Уклонение и освобождение",
    "english": "Dodge & Escape",
    "stat": "REF",
    "multiplier": 1
  },
  {
    "id": "driving",
    "name": "Вождение",
    "english": "Driving",
    "stat": "REF",
    "multiplier": 1
  },
  {
    "id": "fencing",
    "name": "Фехтование",
    "english": "Fencing",
    "stat": "REF",
    "multiplier": 1
  },
  {
    "id": "handgun",
    "name": "Пистолеты",
    "english": "Handgun",
    "stat": "REF",
    "multiplier": 1
  },
  {
    "id": "heavyweapons",
    "name": "Тяжёлое оружие",
    "english": "Heavy Weapons",
    "stat": "REF",
    "multiplier": 1
  },
  {
    "id": "aikido",
    "name": "Айкидо",
    "english": "Aikido",
    "stat": "REF",
    "multiplier": 3
  },
  {
    "id": "animal-kung-fu",
    "name": "Звериное кунг-фу",
    "english": "Animal Kung Fu",
    "stat": "REF",
    "multiplier": 3,
    "detailLabel": "Стиль, например тигр"
  },
  {
    "id": "boxing",
    "name": "Бокс",
    "english": "Boxing",
    "stat": "REF",
    "multiplier": 1
  },
  {
    "id": "capoeira",
    "name": "Капоэйра",
    "english": "Capoeira",
    "stat": "REF",
    "multiplier": 3
  },
  {
    "id": "choi-li-fut",
    "name": "Чой Ли Фут",
    "english": "Choi Li Fut",
    "stat": "REF",
    "multiplier": 3
  },
  {
    "id": "judo",
    "name": "Дзюдо",
    "english": "Judo",
    "stat": "REF",
    "multiplier": 1
  },
  {
    "id": "karate",
    "name": "Карате",
    "english": "Karate",
    "stat": "REF",
    "multiplier": 2
  },
  {
    "id": "tae-kwon-do",
    "name": "Тхэквондо",
    "english": "Tae Kwon Do",
    "stat": "REF",
    "multiplier": 3
  },
  {
    "id": "thai-boxing",
    "name": "Тайский бокс",
    "english": "Thai Kick Boxing",
    "stat": "REF",
    "multiplier": 4
  },
  {
    "id": "wrestling",
    "name": "Борьба",
    "english": "Wrestling",
    "stat": "REF",
    "multiplier": 1
  },
  {
    "id": "melee",
    "name": "Ближний бой с оружием",
    "english": "Melee",
    "stat": "REF",
    "multiplier": 1
  },
  {
    "id": "motorcycle",
    "name": "Мотоцикл",
    "english": "Motorcycle",
    "stat": "REF",
    "multiplier": 1
  },
  {
    "id": "machinery",
    "name": "Тяжёлая техника",
    "english": "Operate Heavy Machinery",
    "stat": "REF",
    "multiplier": 1
  },
  {
    "id": "pilot-gyro",
    "name": "Пилотирование вертолёта",
    "english": "Pilot Gyro",
    "stat": "REF",
    "multiplier": 3
  },
  {
    "id": "pilot-wing",
    "name": "Пилотирование самолёта",
    "english": "Pilot Fixed Wing",
    "stat": "REF",
    "multiplier": 2
  },
  {
    "id": "pilot-airship",
    "name": "Пилотирование дирижабля",
    "english": "Pilot Dirigible",
    "stat": "REF",
    "multiplier": 2
  },
  {
    "id": "pilot-av",
    "name": "Пилотирование AV",
    "english": "Pilot Vectored Thrust Vehicle",
    "stat": "REF",
    "multiplier": 3
  },
  {
    "id": "rifle",
    "name": "Винтовки и ружья",
    "english": "Rifle",
    "stat": "REF",
    "multiplier": 1
  },
  {
    "id": "stealth",
    "name": "Скрытность",
    "english": "Stealth",
    "stat": "REF",
    "multiplier": 2
  },
  {
    "id": "smg",
    "name": "Пистолеты-пулемёты",
    "english": "Submachinegun",
    "stat": "REF",
    "multiplier": 1
  },
  {
    "id": "aerotech",
    "name": "Авиационная техника",
    "english": "Aero Tech",
    "stat": "TECH",
    "multiplier": 2
  },
  {
    "id": "avtech",
    "name": "Обслуживание AV",
    "english": "AV Tech",
    "stat": "TECH",
    "multiplier": 3
  },
  {
    "id": "basictech",
    "name": "Базовая техника",
    "english": "Basic Tech",
    "stat": "TECH",
    "multiplier": 2
  },
  {
    "id": "cryotank",
    "name": "Работа с криокамерами",
    "english": "Cryotank Operation",
    "stat": "TECH",
    "multiplier": 1
  },
  {
    "id": "deckdesign",
    "name": "Проектирование кибердек",
    "english": "Cyberdeck Design",
    "stat": "TECH",
    "multiplier": 2
  },
  {
    "id": "cybertech",
    "name": "Кибертехника",
    "english": "CyberTech",
    "stat": "TECH",
    "multiplier": 2
  },
  {
    "id": "demolitions",
    "name": "Взрывное дело",
    "english": "Demolitions",
    "stat": "TECH",
    "multiplier": 2
  },
  {
    "id": "disguise",
    "name": "Маскировка",
    "english": "Disguise",
    "stat": "TECH",
    "multiplier": 1
  },
  {
    "id": "electronics",
    "name": "Электроника",
    "english": "Electronics",
    "stat": "TECH",
    "multiplier": 1
  },
  {
    "id": "security",
    "name": "Электронная безопасность",
    "english": "Electronic Security",
    "stat": "TECH",
    "multiplier": 2
  },
  {
    "id": "firstaid",
    "name": "Первая помощь",
    "english": "First Aid",
    "stat": "TECH",
    "multiplier": 1
  },
  {
    "id": "forgery",
    "name": "Подделка документов",
    "english": "Forgery",
    "stat": "TECH",
    "multiplier": 1
  },
  {
    "id": "gyrotech",
    "name": "Обслуживание вертолётов",
    "english": "Gyro Tech",
    "stat": "TECH",
    "multiplier": 3
  },
  {
    "id": "painting",
    "name": "Рисование",
    "english": "Paint or Draw",
    "stat": "TECH",
    "multiplier": 1
  },
  {
    "id": "photography",
    "name": "Фото и видео",
    "english": "Photography & Film",
    "stat": "TECH",
    "multiplier": 1
  },
  {
    "id": "pharmaceuticals",
    "name": "Фармакология",
    "english": "Pharmaceuticals",
    "stat": "TECH",
    "multiplier": 2
  },
  {
    "id": "picklock",
    "name": "Взлом замков",
    "english": "Pick Lock",
    "stat": "TECH",
    "multiplier": 1
  },
  {
    "id": "pickpocket",
    "name": "Карманные кражи",
    "english": "Pick Pocket",
    "stat": "TECH",
    "multiplier": 1
  },
  {
    "id": "instrument",
    "name": "Музыкальный инструмент",
    "english": "Play Instrument",
    "stat": "TECH",
    "multiplier": 1,
    "detailLabel": "Какой инструмент"
  },
  {
    "id": "weaponsmith",
    "name": "Оружейное дело",
    "english": "Weaponsmith",
    "stat": "TECH",
    "multiplier": 2
  }
];
export const CREATION_ROLES = [
  {
    "id": "solo",
    "label": "Соло",
    "english": "Solo",
    "ability": {
      "id": "combat-sense",
      "name": "Боевое чутьё",
      "english": "Combat Sense",
      "stat": "INT",
      "multiplier": 1,
      "special": true
    },
    "career": [
      "notice",
      "handgun",
      "$combat",
      "melee",
      "weaponsmith",
      "rifle",
      "athletics",
      "smg",
      "stealth"
    ],
    "summary": "Бой, сопровождение и защита. Combat Sense даёт бонус к внимательности и инициативе."
  },
  {
    "id": "rockerboy",
    "label": "Рокербой",
    "english": "Rockerboy",
    "ability": {
      "id": "charismatic-leadership",
      "name": "Харизматическое лидерство",
      "english": "Charismatic Leadership",
      "stat": "COOL",
      "multiplier": 1,
      "special": true
    },
    "career": [
      "notice",
      "perform",
      "style",
      "composition",
      "brawling",
      "instrument",
      "streetwise",
      "persuasion",
      "seduction"
    ],
    "summary": "Артист и голос улицы. Special Ability позволяет влиять на толпу от десяти человек."
  },
  {
    "id": "netrunner",
    "label": "Нетраннер",
    "english": "Netrunner",
    "ability": {
      "id": "interface",
      "name": "Интерфейс",
      "english": "Interface",
      "stat": "INT",
      "multiplier": 1,
      "special": true
    },
    "career": [
      "notice",
      "basictech",
      "education",
      "systems",
      "cybertech",
      "deckdesign",
      "composition",
      "electronics",
      "programming"
    ],
    "summary": "Специалист по Сети и взлому. Interface нужен для специальных функций Net Menu."
  },
  {
    "id": "techie",
    "label": "Техник",
    "english": "Techie",
    "ability": {
      "id": "jury-rig",
      "name": "Временный ремонт",
      "english": "Jury Rig",
      "stat": "TECH",
      "multiplier": 1,
      "special": true
    },
    "career": [
      "notice",
      "basictech",
      "cybertech",
      "teaching",
      "education",
      "electronics",
      "$tech1",
      "$tech2",
      "$tech3"
    ],
    "summary": "Ремонт и изготовление. Jury Rig позволяет временно починить или переделать устройство."
  },
  {
    "id": "medtechie",
    "label": "Медтехник",
    "english": "Medtechie",
    "ability": {
      "id": "medical-tech",
      "name": "Медицинская техника",
      "english": "Medical Tech",
      "stat": "TECH",
      "multiplier": 1,
      "special": true
    },
    "career": [
      "notice",
      "basictech",
      "diagnose",
      "education",
      "cryotank",
      "library",
      "pharmaceuticals",
      "zoology",
      "perception"
    ],
    "summary": "Лечение и хирургия. Medical Tech открывает серьёзные медицинские процедуры."
  },
  {
    "id": "media",
    "label": "Медиа",
    "english": "Media",
    "ability": {
      "id": "credibility",
      "name": "Достоверность",
      "english": "Credibility",
      "stat": "INT",
      "multiplier": 1,
      "special": true
    },
    "career": [
      "notice",
      "composition",
      "education",
      "persuasion",
      "perception",
      "social",
      "streetwise",
      "photography",
      "interview"
    ],
    "summary": "Журналист и расследователь. Credibility помогает добиться доверия к сведениям."
  },
  {
    "id": "cop",
    "label": "Коп",
    "english": "Cop",
    "ability": {
      "id": "authority",
      "name": "Власть закона",
      "english": "Authority",
      "stat": "COOL",
      "multiplier": 1,
      "special": true
    },
    "career": [
      "notice",
      "handgun",
      "perception",
      "athletics",
      "education",
      "brawling",
      "melee",
      "interrogation",
      "streetwise"
    ],
    "summary": "Представитель закона. Authority работает через положение и реальные полномочия."
  },
  {
    "id": "corporate",
    "label": "Корпорат",
    "english": "Corporate",
    "ability": {
      "id": "resources",
      "name": "Ресурсы",
      "english": "Resources",
      "stat": "INT",
      "multiplier": 1,
      "special": true
    },
    "career": [
      "notice",
      "perception",
      "education",
      "library",
      "social",
      "persuasion",
      "stocks",
      "style",
      "grooming"
    ],
    "summary": "Корпоративный сотрудник. Resources показывает доступ к ресурсам компании, не личный кошелёк."
  },
  {
    "id": "fixer",
    "label": "Фиксер",
    "english": "Fixer",
    "ability": {
      "id": "streetdeal",
      "name": "Уличные сделки",
      "english": "Streetdeal",
      "stat": "COOL",
      "multiplier": 1,
      "special": true
    },
    "career": [
      "notice",
      "forgery",
      "handgun",
      "brawling",
      "melee",
      "picklock",
      "pickpocket",
      "intimidate",
      "persuasion"
    ],
    "summary": "Контакты, информация и сделки. Streetdeal помогает найти людей, слухи и нужные товары."
  },
  {
    "id": "nomad",
    "label": "Кочевник",
    "english": "Nomad",
    "ability": {
      "id": "family",
      "name": "Семья",
      "english": "Family",
      "stat": "INT",
      "multiplier": 1,
      "special": true
    },
    "career": [
      "notice",
      "endurance",
      "melee",
      "rifle",
      "driving",
      "basictech",
      "survival",
      "brawling",
      "athletics"
    ],
    "summary": "Участник кочевого клана. Family позволяет обращаться за помощью к большой семье."
  }
];
export const SKILL_BY_ID = Object.fromEntries([...CORE_SKILLS, ...CREATION_ROLES.map(role => role.ability)].map(skill => [skill.id, skill]));
export const MARTIAL_SKILL_IDS = [
  "aikido",
  "animal-kung-fu",
  "boxing",
  "capoeira",
  "choi-li-fut",
  "judo",
  "karate",
  "tae-kwon-do",
  "thai-boxing",
  "wrestling"
];
export const GEAR_OPTIONS = [
  {
    "id": "core-budgetarms-c-13",
    "name": "BudgetArms C-13",
    "category": "weapon",
    "slot": "mainHand",
    "price": {
      "value": 75,
      "currency": "eb",
      "unit": null,
      "raw": "75"
    },
    "source": {
      "bookId": "core",
      "printedPage": 61,
      "pdfPage": 64
    },
    "facts": {
      "type": "P",
      "WA": -1,
      "concealability": "P",
      "availability": "E",
      "damage": "1D6",
      "caliber": "5mm",
      "shots": 8,
      "ROF": 2,
      "reliability": "ST",
      "range": "50m"
    },
    "effects": [],
    "dependencies": [],
    "notes": [],
    "verification": "text-and-page",
    "label": "Лёгкий пистолет BudgetArms C-13"
  },
  {
    "id": "core-militech-arms-avenger",
    "name": "Militech Arms Avenger",
    "category": "weapon",
    "slot": "mainHand",
    "price": {
      "value": 250,
      "currency": "eb",
      "unit": null,
      "raw": "250"
    },
    "source": {
      "bookId": "core",
      "printedPage": 61,
      "pdfPage": 64
    },
    "facts": {
      "type": "P",
      "WA": 0,
      "concealability": "J",
      "availability": "E",
      "damage": "2D6+1",
      "caliber": "9mm",
      "shots": 10,
      "ROF": 2,
      "reliability": "VR",
      "range": "50m"
    },
    "effects": [],
    "dependencies": [],
    "notes": [],
    "verification": "text-and-page",
    "label": "Пистолет Militech Arms Avenger"
  },
  {
    "id": "core-militech-ronin-light-assault",
    "name": "Militech Ronin Light Assault",
    "category": "weapon",
    "slot": "mainHand",
    "price": {
      "value": 450,
      "currency": "eb",
      "unit": null,
      "raw": "450"
    },
    "source": {
      "bookId": "core",
      "printedPage": 61,
      "pdfPage": 64
    },
    "facts": {
      "type": "RIF",
      "WA": 1,
      "concealability": "N",
      "availability": "C",
      "damage": "5D6",
      "caliber": "5.56mm",
      "shots": 35,
      "ROF": 30,
      "reliability": "VR",
      "range": "400m"
    },
    "effects": [],
    "dependencies": [],
    "notes": [],
    "verification": "text-and-page",
    "label": "Винтовка Militech Ronin"
  },
  {
    "id": "core-kevlar-t-shirt-vest",
    "name": "Kevlar T-Shirt, Vest",
    "category": "armor",
    "slot": "innerTorso",
    "price": {
      "value": 90,
      "currency": "eb",
      "unit": null,
      "raw": "90"
    },
    "source": {
      "bookId": "core",
      "printedPage": 67,
      "pdfPage": 70
    },
    "facts": {
      "SP": 10,
      "EV": 0,
      "coverage": [
        "torso"
      ],
      "armorType": "soft",
      "edgedWeaponsHalfSP": true
    },
    "effects": [],
    "dependencies": [],
    "notes": [],
    "verification": "text-and-page",
    "label": "Кевларовый жилет"
  },
  {
    "id": "core-light-armor-jacket",
    "name": "Light Armor jacket",
    "category": "armor",
    "slot": "outerTorso",
    "price": {
      "value": 150,
      "currency": "eb",
      "unit": null,
      "raw": "150"
    },
    "source": {
      "bookId": "core",
      "printedPage": 67,
      "pdfPage": 70
    },
    "facts": {
      "SP": 14,
      "EV": 0,
      "coverage": [
        "torso",
        "rightArm",
        "leftArm"
      ],
      "armorType": "soft",
      "edgedWeaponsHalfSP": true
    },
    "effects": [],
    "dependencies": [],
    "notes": [],
    "verification": "text-and-page",
    "label": "Лёгкая бронекуртка"
  },
  {
    "id": "core-tech-toolkit",
    "name": "Tech Toolkit",
    "category": "gear",
    "slot": null,
    "price": {
      "value": 100,
      "currency": "eb",
      "unit": null,
      "raw": "100"
    },
    "source": {
      "bookId": "core",
      "printedPage": 68,
      "pdfPage": 71
    },
    "facts": {
      "family": "tools"
    },
    "effects": [],
    "dependencies": [],
    "notes": [],
    "verification": "text-and-page",
    "label": "Набор техника"
  },
  {
    "id": "core-b-e-tools",
    "name": "B & E Tools",
    "category": "gear",
    "slot": null,
    "price": {
      "value": 120,
      "currency": "eb",
      "unit": null,
      "raw": "120"
    },
    "source": {
      "bookId": "core",
      "printedPage": 68,
      "pdfPage": 71
    },
    "facts": {
      "family": "tools"
    },
    "effects": [],
    "dependencies": [],
    "notes": [],
    "verification": "text-and-page",
    "label": "Инструменты взломщика"
  },
  {
    "id": "core-electronics-toolkit",
    "name": "Electronics Toolkit",
    "category": "gear",
    "slot": null,
    "price": {
      "value": 100,
      "currency": "eb",
      "unit": null,
      "raw": "100"
    },
    "source": {
      "bookId": "core",
      "printedPage": 68,
      "pdfPage": 71
    },
    "facts": {
      "family": "tools"
    },
    "effects": [],
    "dependencies": [],
    "notes": [],
    "verification": "text-and-page",
    "label": "Набор электроника"
  },
  {
    "id": "core-first-aid-kit",
    "name": "First Aid Kit",
    "category": "gear",
    "slot": null,
    "price": {
      "value": 10,
      "currency": "eb",
      "unit": null,
      "raw": "10"
    },
    "source": {
      "bookId": "core",
      "printedPage": 68,
      "pdfPage": 71
    },
    "facts": {
      "family": "medical"
    },
    "effects": [],
    "dependencies": [],
    "notes": [],
    "verification": "text-and-page",
    "label": "Аптечка"
  },
  {
    "id": "core-biomonitor",
    "name": "Biomonitor",
    "category": "cyber",
    "slot": null,
    "price": {
      "value": 100,
      "currency": "eb",
      "unit": null,
      "raw": "100"
    },
    "source": {
      "bookId": "core",
      "printedPage": 76,
      "pdfPage": 79
    },
    "facts": {
      "group": "Fashionware",
      "humanityLoss": "1",
      "surgery": "N",
      "code": "BIO"
    },
    "effects": [
      {
        "text": "Monitor vital signs; +2 to Resist Torture & Drugs checks.",
        "automatic": false
      }
    ],
    "dependencies": [],
    "notes": [],
    "verification": "text-and-page",
    "label": "Биомонитор"
  },
  {
    "id": "core-skinwatch",
    "name": "Skinwatch",
    "category": "cyber",
    "slot": null,
    "price": {
      "value": 50,
      "currency": "eb",
      "unit": null,
      "raw": "50"
    },
    "source": {
      "bookId": "core",
      "printedPage": 76,
      "pdfPage": 79
    },
    "facts": {
      "group": "Fashionware",
      "humanityLoss": "1",
      "surgery": "N",
      "code": "SWTC"
    },
    "effects": [
      {
        "text": "Subdermal time display.",
        "automatic": false
      }
    ],
    "dependencies": [],
    "notes": [],
    "verification": "text-and-page",
    "label": "Подкожные часы"
  },
  {
    "id": "core-synthskins",
    "name": "Synthskins",
    "category": "cyber",
    "slot": null,
    "price": {
      "value": 400,
      "currency": "eb",
      "unit": null,
      "raw": "400"
    },
    "source": {
      "bookId": "core",
      "printedPage": 76,
      "pdfPage": 79
    },
    "facts": {
      "group": "Fashionware",
      "humanityLoss": "1D6",
      "surgery": "N",
      "code": "SYN",
      "tuningChipPrice": 100,
      "detailSources": [
        {
          "bookId": "core",
          "printedPage": 80,
          "pdfPage": 83
        }
      ]
    },
    "effects": [
      {
        "text": "Artificial skin with adjustable colors and patterns.",
        "automatic": false
      },
      {
        "text": "Appearance patterns are configured using tuning chips.",
        "automatic": false
      }
    ],
    "dependencies": [],
    "notes": [],
    "verification": "text-and-page",
    "label": "Синтекожа"
  }
];
export const GEAR_BY_ID = Object.fromEntries(GEAR_OPTIONS.map(item => [item.id,item]));
export const SALARY_TABLE = {
  "Rockerboy": [
    1000,
    1500,
    2000,
    5000,
    8000,
    12000
  ],
  "Solo": [
    2000,
    3000,
    4500,
    7000,
    9000,
    12000
  ],
  "Cop": [
    1000,
    1200,
    3000,
    5000,
    7000,
    9000
  ],
  "Corporate": [
    1500,
    3000,
    5000,
    7000,
    9000,
    12000
  ],
  "Media": [
    1000,
    1200,
    3000,
    5000,
    7000,
    10000
  ],
  "Fixer": [
    1500,
    3000,
    5000,
    7000,
    8000,
    10000
  ],
  "Techie": [
    1000,
    2000,
    3000,
    4000,
    5000,
    8000
  ],
  "Netrunner": [
    1000,
    2000,
    3000,
    5000,
    7000,
    10000
  ],
  "Medtechie": [
    1600,
    3000,
    5000,
    7000,
    10000,
    15000
  ],
  "Nomad": [
    1000,
    1500,
    2000,
    3000,
    4000,
    5000
  ]
};
export const CASH_RULE = {
  status:'verified',
  source:'Cyberpunk 2020, Core 2.01, печатные стр. 25, 58–59 / PDF 28, 61–62',
  formula:'salary × max(1, floor(d6 ÷ 3))',
  note:'Общее округление Core, стр. 25: вниз, минимум 1. Броски денег 1–5 дают один месячный оклад, 6 — два. Отдельный d6 на занятость: 5–6 означает безработицу.'
};
export const CREATION_STEPS = [
  {
    "id": "identity",
    "label": "Личность"
  },
  {
    "id": "stats",
    "label": "Характеристики"
  },
  {
    "id": "career",
    "label": "Профессия"
  },
  {
    "id": "pickup",
    "label": "Другие навыки"
  },
  {
    "id": "lifepath",
    "label": "История"
  },
  {
    "id": "gear",
    "label": "Деньги и вещи"
  }
];
export const LIFEPATH_FIELDS = [
  {
    "id": "origin",
    "label": "Происхождение"
  },
  {
    "id": "style",
    "label": "Стиль и внешность"
  },
  {
    "id": "family",
    "label": "Семья и детство"
  },
  {
    "id": "motivation",
    "label": "Ценности и цель"
  },
  {
    "id": "contact",
    "label": "Важный человек"
  },
  {
    "id": "age",
    "label": "Возраст"
  },
  {
    "id": "events",
    "label": "События после 16 лет"
  }
];
export const PREPARED_HEROES = [
  {
    "id": "ray",
    "name": "Рэй",
    "roleId": "solo",
    "role": "Соло",
    "tagline": "Прикрывает команду и замечает угрозы",
    "description": "Синтетический учебный герой. Можно изменить любое поле."
  },
  {
    "id": "vega",
    "name": "Вега",
    "roleId": "techie",
    "role": "Техник",
    "tagline": "Разбирается в электронике и находит обходной путь",
    "description": "Синтетический учебный герой. Можно изменить любое поле."
  }
];
