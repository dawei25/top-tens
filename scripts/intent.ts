// Curated "what the player meant" layer, applied by build.ts after the automatic aliases.
//
// same:   extra aliases for one entry: what a person who knows the answer would type (abbreviations,
//         nicknames, everyday names, former names, names with or without a country prefix).
// groups: one name a player would sincerely type that covers several entries; the game asks which one.
//
// Rule: never hand a player a top-10 answer they did not actually name. "Japan" is not Honshu, "Indonesia"
// is not Borneo. Entry names must match the built JSON exactly; the build fails on a name it can't find.

export interface Intent {
  same?: Record<string, string[]>;
  groups?: Record<string, string[]>;
}

/**
 * Everyday names for countries, applied to every topic whose universe includes countries. Each line is one
 * country; the build finds the entry whose name is one of the forms and gives it all the others.
 */
export const COUNTRY_FORMS: string[][] = [
  ["United States", "USA", "US", "U.S.", "U.S.A.", "America", "United States of America", "the States"],
  ["United Kingdom", "UK", "U.K.", "Britain", "Great Britain", "GB", "England", "Scotland", "Wales"],
  ["China", "PRC", "People's Republic of China", "Mainland China"],
  ["Taiwan", "Republic of China", "ROC", "Chinese Taipei", "Formosa"],
  ["Russia", "Russian Federation"],
  ["Soviet Union", "USSR", "U.S.S.R.", "Soviet", "CCCP"],
  ["South Korea", "Korea", "Republic of Korea", "ROK"],
  ["North Korea", "DPRK", "Democratic People's Republic of Korea"],
  ["DR Congo", "Democratic Republic of the Congo", "DRC", "Congo-Kinshasa", "Zaire", "Congo DR", "DR of Congo"],
  ["Republic of the Congo", "Congo-Brazzaville", "Congo Republic"],
  ["Ivory Coast", "Côte d'Ivoire", "Cote d'Ivoire"],
  ["Czech Republic", "Czechia"],
  ["Turkey", "Türkiye", "Turkiye"],
  ["Netherlands", "Holland", "The Netherlands"],
  ["United Arab Emirates", "UAE", "Emirates"],
  ["Myanmar", "Burma"],
  ["Eswatini", "Swaziland"],
  ["North Macedonia", "Macedonia"],
  ["Cape Verde", "Cabo Verde"],
  ["East Timor", "Timor-Leste"],
  ["Vatican City", "Vatican", "Holy See"],
  ["Iran", "Persia"],
  ["Sri Lanka", "Ceylon"],
  ["Thailand", "Siam"],
  ["Saudi Arabia", "KSA", "Saudi"],
  ["Germany", "Deutschland"],
  ["West Germany", "FRG"],
  ["East Germany", "GDR", "DDR"],
  ["Bosnia and Herzegovina", "Bosnia"],
  ["Trinidad and Tobago", "Trinidad"],
  ["Papua New Guinea", "PNG"],
  ["New Zealand", "NZ", "Aotearoa"],
  ["Philippines", "The Philippines"],
  ["Bahamas", "The Bahamas"],
  ["Gambia", "The Gambia"],
  ["Hong Kong", "HK"],
  ["Macau", "Macao"],
  ["Vietnam", "Viet Nam"],
  ["Laos", "Lao PDR"],
  ["Micronesia", "Federated States of Micronesia"],
  ["Palestine", "State of Palestine", "Palestinian territories"],
  ["São Tomé and Príncipe", "Sao Tome and Principe", "Sao Tome"],
  ["Kyrgyzstan", "Kyrgyz Republic"],
  ["Ireland", "Republic of Ireland", "Eire"],
];

export const INTENT: Record<string, Intent> = {
  islands: {
    same: {
      "Great Britain": ["UK", "United Kingdom", "Britain", "England", "Scotland", "Wales", "GB"],
      "New Guinea": ["Papua New Guinea", "PNG", "Papua"],
      Borneo: ["Kalimantan"],
      "Baffin Island": ["Baffin"],
      Honshu: ["Honshū"],
      "Victoria Island": ["Victoria"],
      "Ellesmere Island": ["Ellesmere"],
      Ireland: ["Republic of Ireland", "Northern Ireland", "Eire"],
      Hispaniola: ["Haiti", "Dominican Republic"],
      Spitsbergen: ["Svalbard"],
      "Isla Grande de Tierra del Fuego": ["Tierra del Fuego"],
      Sulawesi: ["Celebes"],
      Newfoundland: ["Newfoundland and Labrador"],
    },
    groups: {
      "New Zealand": ["North Island", "South Island"],
    },
  },
  mountains: {
    same: {
      "Mount Everest": ["Everest", "Sagarmatha", "Chomolungma", "Qomolangma", "Mt Everest"],
      K2: ["Mount Godwin-Austen", "Chogori"],
      Kangchenjunga: ["Kanchenjunga", "Khangchendzonga"],
      "Dhaulagiri I": ["Dhaulagiri"],
      "Annapurna I": ["Annapurna"],
      "Gasherbrum I": ["Hidden Peak"],
    },
  },
  rivers: {
    same: {
      Yenisey: ["Yenisei", "Yenisei River", "Yenisey River"],
      Yangtze: ["Chang Jiang", "Yangtze River", "Yangzi"],
      "Yellow River": ["Huang He", "Huanghe"],
      Ob: ["Ob River", "Irtysh", "Ob-Irtysh"],
      "Río de la Plata": ["Parana", "Paraná", "River Plate", "Parana River"],
      Congo: ["Congo River", "Zaire River"],
      Mississippi: ["Mississippi River", "Mississippi-Missouri", "Missouri", "Missouri River"],
      Padma: ["Ganges", "Ganga", "Ganges River"],
      "Shatt al-Arab": ["Euphrates"],
      Murray: ["Murray-Darling", "Darling"],
      Amur: ["Amur River", "Heilong Jiang"],
      Nile: ["Nile River", "River Nile", "White Nile"],
      Amazon: ["Amazon River", "River Amazon"],
    },
  },
  lakes: {
    same: {
      "Caspian Sea": ["Caspian", "Caspian Lake"],
      Superior: ["Lake Superior"],
      Victoria: ["Lake Victoria"],
      Huron: ["Lake Huron"],
      Michigan: ["Lake Michigan"],
      Tanganyika: ["Lake Tanganyika"],
      Baikal: ["Lake Baikal", "Baykal"],
      "Great Bear Lake": ["Great Bear"],
      Malawi: ["Lake Malawi", "Lake Nyasa", "Nyasa"],
      "Great Slave Lake": ["Great Slave"],
    },
    groups: {
      "Michigan-Huron": ["Michigan", "Huron"],
    },
  },
  "world-cities": {
    same: {
      Delhi: ["New Delhi", "Dilli"],
      Kolkata: ["Calcutta"],
      Mumbai: ["Bombay"],
      Chennai: ["Madras"],
      Guangzhou: ["Canton"],
      Beijing: ["Peking"],
      "Ho Chi Minh City": ["Saigon", "HCMC"],
      Dhaka: ["Dacca"],
      Bengaluru: ["Bangalore"],
    },
  },
  "youtube-channels": {
    same: {
      "SET India": ["Sony Entertainment Television", "Sony TV", "SET"],
      "김프로KIMPRO": ["Kimpro", "Kim Pro"],
      "Kids Diana Show": ["Diana and Roma", "Kids Diana"],
      "Like Nastya": ["Nastya"],
      "Cocomelon - Nursery Rhymes": ["CoComelon"],
      MrBeast: ["Mr Beast", "Jimmy Donaldson"],
    },
  },
  "youtube-videos": {
    same: {
      "Johny Johny Yes Papa": ["Johnny Johnny Yes Papa", "Johnny Johnny"],
      "Axel F": ["Crazy Frog", "Crazy Frog Axel F"],
      "Phonics Song with Two Words": ["Phonics Song", "ChuChu TV Phonics Song"],
      "Gangnam Style": ["Gangnam", "Oppa Gangnam Style"],
      "Wheels on the Bus": ["The Wheels on the Bus"],
    },
    groups: {
      "Baby Shark": ["Baby Shark Dance", "Baby Shark"],
    },
  },
  "video-games": {
    same: {
      "Mario Kart 8": ["Mario Kart 8 Deluxe", "MK8", "MK8D"],
      "Grand Theft Auto V": ["GTA 5", "GTA V"],
      "Grand Theft Auto Online": ["GTA Online"],
      "Red Dead Redemption 2": ["RDR2", "Red Dead 2"],
      "PUBG: Battlegrounds": ["PlayerUnknown's Battlegrounds", "PUBG"],
      "The Elder Scrolls V: Skyrim": ["Skyrim", "Elder Scrolls Skyrim"],
      "The Witcher 3: Wild Hunt": ["Witcher 3", "The Witcher 3"],
    },
    groups: {
      GTA: ["Grand Theft Auto V", "Grand Theft Auto: San Andreas", "Grand Theft Auto IV", "Grand Theft Auto VI"],
      "Grand Theft Auto": ["Grand Theft Auto V", "Grand Theft Auto: San Andreas", "Grand Theft Auto IV", "Grand Theft Auto VI"],
      Zelda: [
        "The Legend of Zelda: Breath of the Wild",
        "The Legend of Zelda: Tears of the Kingdom",
        "The Legend of Zelda: Ocarina of Time",
      ],
    },
  },
  consoles: {
    same: {
      PlayStation: ["PS1", "PSX", "PS One", "PlayStation 1"],
      "PlayStation 2": ["PS2"],
      "PlayStation 3": ["PS3"],
      "PlayStation 4": ["PS4"],
      "PlayStation 5": ["PS5"],
      "Nintendo DS": ["DS"],
      "Nintendo Switch": ["Switch"],
      "Game Boy": ["Gameboy"],
      Wii: ["Nintendo Wii"],
      "Xbox 360": ["X360"],
      "Family Computer/Nintendo Entertainment System": ["NES", "Famicom", "Nintendo Entertainment System"],
      "Super Famicom/Super Nintendo Entertainment System": ["SNES", "Super Nintendo", "Super Famicom"],
      "Nintendo 64": ["N64"],
      "Game Boy Advance": ["GBA"],
      "PlayStation Portable": ["PSP"],
      "Mega Drive/Genesis": ["Sega Genesis", "Genesis", "Sega Mega Drive"],
      "Nintendo GameCube": ["GameCube"],
    },
  },
  books: {
    same: {
      "And Then There Were None": ["Ten Little Indians", "Ten Little Soldiers"],
      "The Alchemist": ["Alchemist"],
      "Dream of the Red Chamber": ["Red Chamber", "The Story of the Stone"],
      "Harry Potter and the Philosopher's Stone": ["Harry Potter and the Sorcerer's Stone", "Philosopher's Stone", "Sorcerer's Stone"],
      "Alice's Adventures in Wonderland": ["Alice in Wonderland"],
      "The Little Prince": ["Le Petit Prince"],
    },
  },
  languages: {
    same: {
      "Mandarin Chinese": ["Mandarin", "Chinese", "Putonghua"],
      "Modern Standard Arabic": ["Arabic"],
      Bengali: ["Bangla"],
      Indonesian: ["Bahasa Indonesia"],
      Spanish: ["Castilian", "Español"],
    },
  },
  buildings: {
    same: {
      "Merdeka Maybank Tower": ["Merdeka 118", "PNB 118", "Merdeka PNB118"],
      "Mecca Royal Clock Tower": ["Abraj Al Bait", "Makkah Royal Clock Tower", "Mecca Clock Tower"],
      "Ping An Finance Centre": ["Ping An Finance Center", "Ping An"],
      "One World Trade Center": ["Freedom Tower", "One WTC", "World Trade Center"],
      "Guangzhou CTF Finance Centre": ["Chow Tai Fook Centre"],
      "CITIC Tower": ["China Zun"],
      "Lotte World Tower": ["Lotte Tower"],
    },
  },
  "nba-points": {
    same: {
      "Magic Johnson": ["Magic", "Earvin Johnson"],
      "LeBron James": ["LeBron", "King James", "LBJ"],
      "Kareem Abdul-Jabbar": ["Kareem", "Lew Alcindor"],
      "Karl Malone": ["The Mailman"],
      "Kobe Bryant": ["Kobe", "Black Mamba"],
      "Kevin Durant": ["KD", "Durant"],
      "Michael Jordan": ["MJ", "Air Jordan"],
      "Dirk Nowitzki": ["Dirk"],
      "Wilt Chamberlain": ["Wilt", "Wilt the Stilt"],
      "James Harden": ["The Beard"],
      "Shaquille O'Neal": ["Shaq", "Shaquille"],
    },
  },
  stadiums: {
    same: {
      "Narendra Modi Stadium": ["Motera Stadium", "Motera"],
      "Michigan Stadium": ["The Big House", "Big House"],
      "Ohio Stadium": ["The Horseshoe", "The Shoe"],
      "Tiger Stadium": ["Death Valley", "LSU Tiger Stadium"],
      "Darrell K Royal–Texas Memorial Stadium": ["Texas Memorial Stadium", "DKR"],
    },
  },
  "companies-revenue": {
    same: {
      Alphabet: ["Google"],
      "China Petrochemical Corporation": ["Sinopec"],
      "China National Petroleum Corporation": ["PetroChina", "CNPC"],
      "Berkshire Hathaway": ["Berkshire"],
      "State Grid Corporation of China": ["State Grid"],
      "Saudi Aramco": ["Aramco"],
      ExxonMobil: ["Exxon", "Exxon Mobil", "Mobil"],
    },
  },
  "super-bowl-wins": {
    same: {
      "New England Patriots": ["Pats", "Boston Patriots", "New England"],
      "Washington Commanders": ["Washington Redskins", "Redskins", "Washington Football Team", "Washington"],
      "Las Vegas Raiders": ["Oakland Raiders", "Los Angeles Raiders", "LA Raiders"],
      "San Francisco 49ers": ["Niners", "SF 49ers"],
      "Kansas City Chiefs": ["KC Chiefs", "KC"],
      "Green Bay Packers": ["Green Bay"],
      "Pittsburgh Steelers": ["Pittsburgh"],
      "Dallas Cowboys": ["Dallas"],
      "Denver Broncos": ["Denver"],
    },
  },
  "world-series-wins": {
    same: {
      "Los Angeles Dodgers": ["Brooklyn Dodgers", "LA Dodgers"],
      Athletics: ["Oakland Athletics", "Oakland A's", "A's", "Philadelphia Athletics", "Kansas City Athletics"],
      "Boston Red Sox": ["Boston Americans", "BoSox"],
      "San Francisco Giants": ["New York Giants", "SF Giants"],
      "Atlanta Braves": ["Boston Braves", "Milwaukee Braves"],
      "St. Louis Cardinals": ["Cards", "St Louis Cardinals"],
      "New York Yankees": ["Yanks", "Bronx Bombers"],
      "Pittsburgh Pirates": ["Bucs"],
    },
  },
  "premier-league-goals": {
    same: {
      "Mohamed Salah": ["Mo Salah", "Salah"],
      "Sergio Agüero": ["Aguero", "Kun Agüero"],
      "Andy Cole": ["Andrew Cole"],
      "Thierry Henry": ["Henry", "Titi"],
      "Alan Shearer": ["Shearer"],
      "Harry Kane": ["Kane"],
      "Wayne Rooney": ["Rooney", "Wazza"],
    },
  },
  "nfl-passing-yards": {
    same: {
      "Tom Brady": ["Brady", "TB12"],
      "Drew Brees": ["Brees"],
      "Peyton Manning": ["Peyton"],
      "Ben Roethlisberger": ["Big Ben", "Roethlisberger"],
      "Matt Ryan": ["Matty Ice"],
      "Dan Marino": ["Marino"],
      "Brett Favre": ["Favre"],
    },
  },
  "nfl-rushing-yards": {
    same: {
      "Emmitt Smith": ["Emmitt"],
      "Walter Payton": ["Sweetness", "Payton"],
      "Adrian Peterson": ["AP", "All Day"],
      "LaDainian Tomlinson": ["LT", "LaDainian"],
      "Jerome Bettis": ["The Bus", "Bettis"],
      "Derrick Henry": ["King Henry"],
      "Barry Sanders": ["Barry"],
    },
  },
  "nhl-goals": {
    same: {
      "Alexander Ovechkin": ["Ovi", "Alex Ovechkin", "Ovechkin"],
      "Wayne Gretzky": ["The Great One", "Gretzky"],
      "Gordie Howe": ["Mr. Hockey", "Howe"],
      "Jaromir Jagr": ["Jaromír Jágr", "Jagr"],
      "Phil Esposito": ["Espo"],
      "Mark Messier": ["Messier", "The Moose"],
      "Steve Yzerman": ["Stevie Y", "Yzerman"],
    },
  },
  "x-accounts": {
    same: {
      "Elon Musk": ["Elon", "Musk"],
      "Barack Obama": ["Obama", "Barack"],
      "Cristiano Ronaldo": ["CR7", "Cristiano", "Ronaldo"],
      "Donald Trump": ["Trump"],
      "Narendra Modi": ["Modi"],
      "Taylor Swift": ["Taylor", "T-Swift"],
      Rihanna: ["RiRi"],
    },
  },
  "tiktok-accounts": {
    same: {
      "Charli D'Amelio": ["Charli", "Charli DAmelio"],
      "Khaby Lame": ["Khaby", "Khabane Lame"],
      MrBeast: ["Mr Beast", "Jimmy Donaldson"],
      "Addison Rae": ["Addison"],
      "FIFA World Cup": ["FIFA", "World Cup"],
      "Bella Poarch": ["Bella"],
    },
  },
  albums: {
    same: {
      "Their Greatest Hits": ["Eagles Greatest Hits", "Their Greatest Hits 1971-1975"],
      "The Bodyguard": ["Bodyguard soundtrack", "The Bodyguard soundtrack"],
      Rumours: ["Rumors"],
      "Saturday Night Fever": ["Saturday Night Fever soundtrack"],
    },
  },
  "animated-films": {
    same: {
      "Frozen II": ["Frozen 2"],
      "The Super Mario Bros. Movie": ["Super Mario Bros Movie", "Mario Movie", "Super Mario Movie"],
      "Zootopia 2": ["Zootropolis 2"],
      "Ne Zha 2": ["Nezha 2"],
    },
  },
  "media-franchises": {
    same: {
      "Mickey Mouse & Friends": ["Mickey Mouse", "Mickey"],
      "Winnie-the-Pooh": ["Winnie the Pooh", "Pooh"],
      "Disney Princess": ["Disney Princesses"],
      "Call of Duty": ["COD"],
      "Marvel Cinematic Universe": ["MCU", "Marvel"],
      "Wizarding World": ["Harry Potter"],
    },
  },
  "game-franchises": {
    same: {
      Mario: ["Super Mario"],
      "Call of Duty": ["COD"],
      "Grand Theft Auto": ["GTA"],
      FIFA: ["EA Sports FC", "EA FC"],
      "Resident Evil": ["Biohazard"],
      "Final Fantasy": ["FF"],
      "Assassin's Creed": ["AC"],
    },
  },
  websites: {
    same: {
      "Google Search": ["Google", "google.com"],
      X: ["Twitter", "x.com"],
      ChatGPT: ["OpenAI", "Chat GPT"],
      "Microsoft Bing": ["Bing"],
      Instagram: ["IG", "Insta"],
      WhatsApp: ["Whats App"],
    },
  },
  "europe-cities": {
    same: {
      Kyiv: ["Kiev"],
      "Saint Petersburg": ["St Petersburg", "St. Petersburg", "Leningrad"],
      Istanbul: ["Constantinople"],
    },
  },
  "india-cities": {
    same: {
      Bengaluru: ["Bangalore"],
      Mumbai: ["Bombay"],
      Chennai: ["Madras"],
      Kolkata: ["Calcutta"],

      Pune: ["Poona"],
    },
  },
  "china-cities": {
    same: {
      Beijing: ["Peking"],
      Guangzhou: ["Canton"],
      "Xi'an": ["Xian"],
      Chongqing: ["Chungking"],
      Tianjin: ["Tientsin"],
    },
  },
  "canada-cities": {
    same: {
      Montreal: ["Montréal"],
    },
  },
  deserts: {
    same: {
      "Sahara Desert": ["Sahara"],
      "Great Australian Desert": ["Australian Desert", "Australian Outback deserts"],
      "Patagonian Desert": ["Patagonia"],
      "Arabian Desert": ["Arabia"],
    },
  },
  "city-visitors": {
    same: {
      Mecca: ["Makkah"],
      "Kuala Lumpur": ["KL"],
      Macau: ["Macao"],
      "Hong Kong": ["HK"],
    },
  },
  "national-parks": {
    same: {
      "Great Smoky Mountains": ["Smoky Mountains", "Smokies", "Great Smokies"],
      "Grand Teton": ["Tetons", "Grand Tetons"],
      "Rocky Mountain": ["Rocky Mountain NP"],
    },
  },
  empires: {
    same: {
      "British Empire": ["British", "Britain"],
      "Mongol Empire": ["Mongols", "Mongolian Empire"],
      "Russian Empire": ["Russia", "Tsarist Russia", "Imperial Russia"],
      "Qing dynasty": ["Qing", "Qing Empire", "Qing China"],
      "Spanish Empire": ["Spain"],
      "Second French colonial empire": ["France", "French Empire", "French colonial empire"],
      "Abbasid Caliphate": ["Abbasids"],
      "Umayyad Caliphate": ["Umayyads"],
      "Yuan dynasty": ["Yuan"],
      "United States": ["USA", "US", "America", "American Empire"],
    },
  },
  moons: {
    same: {
      Moon: ["Luna", "The Moon", "Earth's Moon"],
    },
  },
  museums: {
    same: {
      Louvre: ["The Louvre", "Louvre Museum", "Musée du Louvre"],
      "Vatican Museums": ["Vatican Museum", "Musei Vaticani"],
      "Metropolitan Museum of Art": ["The Met", "Met Museum", "The Metropolitan Museum"],
    },
  },
  "market-cap-peak": {
    same: {
      Meta: ["Facebook", "Meta Platforms"],
      Alphabet: ["Google"],
      TSMC: ["Taiwan Semiconductor"],
      "Saudi Aramco": ["Aramco"],
      ExxonMobil: ["Exxon", "Exxon Mobil", "Mobil"],
    },
  },
  banks: {
    same: {
      "Industrial and Commercial Bank of China": ["ICBC"],
      "Agricultural Bank of China": ["ABC", "Agricultural Bank"],
      "China Construction Bank": ["CCB"],
      "Bank of America": ["BofA", "BoA"],
      "JPMorgan Chase": ["JP Morgan", "Chase", "JPMorgan"],
      "BNP Paribas": ["BNP"],
      "Postal Savings Bank of China": ["Postal Savings Bank", "PSBC"],
    },
  },
  "richest-people": {
    same: {
      "Elon Musk": ["Elon"],
      "Mark Zuckerberg": ["Zuck"],
      "Jensen Huang": ["Jensen"],
      "Warren Buffett": ["Buffet"],
    },
  },
  broadway: {
    same: {
      "The Phantom of the Opera": ["Phantom"],
      Chicago: ["Chicago the Musical"],
      "Les Misérables": ["Les Mis", "Les Miz"],
      "Mamma Mia!": ["Mama Mia"],
      "The Book of Mormon": ["Book of Mormon musical"],
    },
  },
  manga: {
    same: {
      "Case Closed / Detective Conan": ["Detective Conan", "Case Closed", "Conan"],
      "Demon Slayer: Kimetsu no Yaiba": ["Demon Slayer", "Kimetsu no Yaiba"],
      "Jujutsu Kaisen": ["JJK"],
      "KochiKame: Tokyo Beat Cops": ["KochiKame", "Kochira Katsushika-ku Kameari Kōen-mae Hashutsujo"],
      "Dragon Ball": ["Dragonball", "Dragon Ball Z", "DBZ"],
    },
  },
  "nba-assists": {
    same: {
      "Chris Paul": ["CP3"],
      "Magic Johnson": ["Magic", "Earvin Johnson"],
      "Oscar Robertson": ["The Big O", "Big O"],
      "Isiah Thomas": ["Zeke"],
      "LeBron James": ["LeBron", "King James", "LBJ"],
      "Russell Westbrook": ["Russ", "Westbrook"],
      "John Stockton": ["Stockton"],
    },
  },
  "nba-rebounds": {
    same: {
      "Magic Johnson": ["Magic", "Earvin Johnson"],
      "Wilt Chamberlain": ["Wilt", "Wilt the Stilt"],
      "Kareem Abdul-Jabbar": ["Kareem", "Lew Alcindor"],
      "Elvin Hayes": ["The Big E"],
      "Tim Duncan": ["The Big Fundamental", "Duncan"],
      "Karl Malone": ["The Mailman"],
      "Robert Parish": ["The Chief"],
      "Kevin Garnett": ["KG", "Garnett"],
      "Bill Russell": ["Russell"],
    },
  },
  "nhl-points": {
    same: {
      "Wayne Gretzky": ["The Great One", "Gretzky"],
      "Jaromir Jagr": ["Jaromír Jágr", "Jagr"],
      "Gordie Howe": ["Mr. Hockey", "Howe"],
      "Sidney Crosby": ["Sid the Kid", "Sid", "Crosby"],
      "Mario Lemieux": ["Super Mario", "Lemieux"],
      "Alexander Ovechkin": ["Ovi", "Alex Ovechkin", "Ovechkin"],
      "Mark Messier": ["Messier", "The Moose"],
      "Steve Yzerman": ["Stevie Y", "Yzerman"],
    },
  },
  "mlb-hits": {
    same: {
      "Pete Rose": ["Charlie Hustle"],
      "Hank Aaron": ["Hammerin' Hank"],
      "Stan Musial": ["Stan the Man"],
      "Carl Yastrzemski": ["Yaz"],
      "Derek Jeter": ["Jeter"],
    },
  },
  "mlb-home-runs": {
    same: {
      "Babe Ruth": ["The Babe", "The Bambino", "Bambino"],
      "Alex Rodriguez": ["A-Rod", "ARod"],
      "Willie Mays": ["Say Hey Kid"],
      "Ken Griffey Jr.": ["Griffey", "Junior Griffey"],
      "Barry Bonds": ["Bonds"],
      "Hank Aaron": ["Hammerin' Hank"],
    },
  },
  "theme-parks": {
    same: {
      "Magic Kingdom": ["Walt Disney World", "Disney World"],
      Disneyland: ["Disneyland California", "Disneyland Anaheim"],
      "Universal Studios Japan": ["USJ", "Universal Japan"],
      "Disney's Hollywood Studios": ["Hollywood Studios"],
      "Disneyland Park": ["Disneyland Paris", "Euro Disney"],
    },
  },
  "spotify-artists": {
    same: {
      "Bruno Mars": ["Bruno"],
      "Lady Gaga": ["Gaga"],
      "Ariana Grande": ["Ariana"],
      "Taylor Swift": ["Taylor", "T-Swift"],
      "Bad Bunny": ["Benito"],
    },
  },
  "facebook-pages": {
    same: {
      "Real Madrid C.F.": ["Real Madrid"],
      "FC Barcelona": ["Barcelona", "Barca", "Barça"],
      "5-Minute Crafts": ["5 Minute Crafts", "Five Minute Crafts"],
      CGTN: ["China Global Television Network"],
      "Cristiano Ronaldo": ["CR7", "Cristiano", "Ronaldo"],
    },
  },
  "car-makers": {
    same: {
      "Volkswagen Group": ["VW", "Volkswagen"],
      "Hyundai Motor Group": ["Hyundai", "Hyundai-Kia"],
      "General Motors": ["GM"],
      "BYD Auto": ["BYD"],
      "SAIC Motor": ["SAIC"],
    },
  },
  "us-metros": {
    same: {
      "New York–Newark–Jersey City": ["NYC", "New York City", "New York metro", "Tri-State Area"],
      "Los Angeles–Long Beach–Anaheim": ["LA", "Greater Los Angeles"],
      "Dallas–Fort Worth–Arlington": ["DFW", "Dallas-Fort Worth", "Metroplex"],
      "Washington–Arlington–Alexandria": ["DC", "Washington DC", "Washington, D.C."],
      "Miami–Fort Lauderdale–West Palm Beach": ["South Florida"],
      "Philadelphia–Camden–Wilmington": ["Philly"],
      "Houston–Pasadena–The Woodlands": ["Greater Houston"],
      "Atlanta–Sandy Springs–Roswell": ["Metro Atlanta"],
      "Chicago–Naperville–Elgin": ["Chicagoland"],
    },
  },
};
