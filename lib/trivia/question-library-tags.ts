export const STARTER_QUESTION_TAGS = [
  'Pop Culture', 'World Records', 'Famous Quotes',
  '1900s', '1910s', '1920s', '1930s', '1940s', '1950s', '1960s', '1970s',
  '1980s', '1990s', '2000s', '2010s', '2020s', '2030s',
  'Film', 'Television', 'Books', 'Theatre', 'Comedy', 'Radio', 'Podcasts', 'Streaming',
  'Celebrities', 'Actors', 'Directors', 'Musicians', 'Bands', 'Songs', 'Albums',
  'Reality TV', 'Sitcoms', 'Cartoons', 'Animation', "Children's Media", 'Comics',
  'Superheroes', 'Awards', 'Advertising', 'Logos', 'Soundtracks', 'Credits', 'Silhouettes',
  'Marvel', 'DC', 'Disney', 'Harry Potter', 'Star Wars', 'The Simpsons', 'Pokémon',
  'James Bond', 'The Lord of the Rings', 'Game of Thrones',
  'Royalty', 'Law', 'Crime', 'Military', 'Weapons', 'Human Rights', 'Religion',
  'Mythology', 'LGBTQ+', 'Relationships', 'Sexuality', 'Education', 'Universities',
  'Holidays', 'Festivals',
  'Australia', 'New Zealand', 'United States', 'Canada', 'United Kingdom', 'Europe',
  'Asia', 'Africa', 'South America', 'Middle East', 'Oceania', 'Countries', 'Cities',
  'National Capitals', 'Flags', 'Maps', 'Landmarks', 'Architecture', 'Oceans', 'Rivers',
  'Mountains', 'Islands',
  'Biology', 'Chemistry', 'Physics', 'Space', 'Medicine', 'Psychology', 'Human Body',
  'Anatomy', 'Engineering', 'Inventions', 'Discoveries', 'Maths', 'Animals', 'Plants',
  'Environment', 'Weather', 'Natural Disasters', 'Dinosaurs',
  'Olympics', 'AFL', 'NRL', 'Cricket', 'Soccer', 'Rugby Union', 'Rugby League',
  'Tennis', 'Golf', 'Motorsport', 'Basketball', 'Baseball', 'American Football',
  'Combat Sports', 'Horse Racing',
  'Food', 'Drink', 'Alcohol', 'Brands', 'Companies', 'Products', 'Money', 'Economics',
  'Art', 'Paintings', 'Artists', 'Sculpture', 'Museums', 'Fashion', 'Design',
  'Agriculture', 'Manufacturing', 'Transport', 'Cars', 'Aviation', 'Maritime', 'Trains',
  'Roads', 'Toys', 'Board Games', 'Card Games', 'Video Games', 'Internet',
  'Internet Culture', 'Social Media', 'Memes', 'Etymology', 'Spelling', 'Grammar',
  'Poetry', 'Authors', 'Lyrics',
] as const

export const STARTER_QUESTION_TAG_ALIASES: Readonly<Record<string, string>> = {
  USA: 'United States',
  US: 'United States',
  'U.S.': 'United States',
  UK: 'United Kingdom',
  Movies: 'Film',
  Movie: 'Film',
  TV: 'Television',
  LOTR: 'The Lord of the Rings',
  Pokemon: 'Pokémon',
  '90s': '1990s',
  "'90s": '1990s',
  'the 90s': '1990s',
  '80s': '1980s',
  "'80s": '1980s',
  'the 80s': '1980s',
  '00s': '2000s',
  "'00s": '2000s',
  'the 2000s': '2000s',
  "2000's": '2000s',
}

export function normalizeTagPhrase(value: string) {
  return value.normalize('NFKD').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

const STARTER_TAG_NAMES = new Set(STARTER_QUESTION_TAGS.map(normalizeTagPhrase))
const STARTER_TAG_ALIAS_NAMES = new Set(Object.keys(STARTER_QUESTION_TAG_ALIASES).map(normalizeTagPhrase))

export function isStarterTagOrAlias(value: string) {
  const normalized = normalizeTagPhrase(value)
  return STARTER_TAG_NAMES.has(normalized) || STARTER_TAG_ALIAS_NAMES.has(normalized)
}
