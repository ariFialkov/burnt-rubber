// Name pools keyed by nationality, used to procedurally build each tour's
// racer bank. Flags are emoji so they render everywhere without assets.

export const NATIONS = [
  { code: 'ES', flag: '🇪🇸', first: ['Álvaro', 'Iker', 'Marc', 'Sergio', 'Pau', 'Dani', 'Javi', 'Carlos'], last: ['Cortés', 'Peña', 'Vidal', 'Sainz-Rocha', 'Almagro', 'Bermejo', 'Táravo', 'Ordoñez'] },
  { code: 'FR', flag: '🇫🇷', first: ['Théo', 'Luca', 'Esteban', 'Romain', 'Hugo', 'Bastien', 'Maël', 'Adrien'], last: ['Moreau', 'Girard', 'Lefebvre', 'Duval', 'Perrin', 'Vasseur', 'Chastain', 'Baudry'] },
  { code: 'IT', flag: '🇮🇹', first: ['Matteo', 'Lorenzo', 'Enzo', 'Giulio', 'Nico', 'Dario', 'Franco', 'Pietro'], last: ['Ricci', 'Baldini', 'Moretti', 'Colombo', 'Sartori', 'Vittori', 'De Luca', 'Pagani'] },
  { code: 'GB', flag: '🇬🇧', first: ['Ollie', 'Harry', 'Callum', 'Lewis', 'Jenson', 'Freddie', 'Arthur', 'George'], last: ['Whitfield', 'Barnes', 'Hollis', 'Cartwright', 'Meadows', 'Ashcroft', 'Doyle', 'Prescott'] },
  { code: 'DE', flag: '🇩🇪', first: ['Max', 'Lukas', 'Finn', 'Jonas', 'Timo', 'Erik', 'Nils', 'Moritz'], last: ['Keller', 'Brandt', 'Vogler', 'Schreiber', 'Hartmann', 'Lindner', 'Falk', 'Ziegler'] },
  { code: 'US', flag: '🇺🇸', first: ['Chase', 'Austin', 'Tyler', 'Cole', 'Brady', 'Wyatt', 'Denny', 'Rusty'], last: ['Hutchins', 'McCray', 'Ballard', 'Truett', 'Kowalski', 'Dillard', 'Stokes', 'Ramsey'] },
  { code: 'BR', flag: '🇧🇷', first: ['Thiago', 'Rafael', 'Gustavo', 'Bruno', 'Caio', 'Felipe', 'Vitor', 'André'], last: ['Moraes', 'Cardoso', 'Siqueira', 'Barbosa', 'Fontana', 'Duarte', 'Rezende', 'Peixoto'] },
  { code: 'JP', flag: '🇯🇵', first: ['Ren', 'Sota', 'Kaito', 'Yuki', 'Haruto', 'Daiki', 'Sho', 'Riku'], last: ['Kobayashi', 'Nakagawa', 'Fujimoto', 'Sakurai', 'Hoshino', 'Maeda', 'Ogawa', 'Takei'] },
  { code: 'AU', flag: '🇦🇺', first: ['Jack', 'Lachlan', 'Riley', 'Cooper', 'Flynn', 'Ned', 'Baxter', 'Darcy'], last: ['Sutherland', 'McAllister', 'Hargreaves', 'Boyd', 'Callahan', 'Winter', 'Fraser', 'Okely'] },
  { code: 'MX', flag: '🇲🇽', first: ['Diego', 'Emilio', 'Santiago', 'Rodrigo', 'Ángel', 'Mateo', 'Iván', 'Raúl'], last: ['Fuentes', 'Salazar', 'Cervantes', 'Ibarra', 'Quintero', 'Villalobos', 'Mendoza', 'Zapata'] },
  { code: 'FI', flag: '🇫🇮', first: ['Elias', 'Onni', 'Väinö', 'Aleksi', 'Jari', 'Mika', 'Kimi', 'Juho'], last: ['Korhonen', 'Virtanen', 'Mäkelä', 'Salomaa', 'Hakkola', 'Rautio', 'Peltonen', 'Kuosmanen'] },
  { code: 'SE', flag: '🇸🇪', first: ['Oscar', 'Viktor', 'Axel', 'Nils', 'Hampus', 'Ludvig', 'Emil', 'Sixten'], last: ['Lindqvist', 'Bergström', 'Åkesson', 'Nyman', 'Sandell', 'Holmgren', 'Dahl', 'Ekelund'] },
  { code: 'ZA', flag: '🇿🇦', first: ['Ruan', 'Divan', 'Keagan', 'Sipho', 'Werner', 'Lloyd', 'Tristan', 'Neo'], last: ['van Wyk', 'Botha', 'Naidoo', 'Pretorius', 'Mokoena', 'du Toit', 'Steyn', 'Khumalo'] },
  { code: 'AR', flag: '🇦🇷', first: ['Franco', 'Nicolás', 'Joaquín', 'Bautista', 'Lautaro', 'Facundo', 'Tomás', 'Agustín'], last: ['Herrera', 'Bianchi', 'Ledesma', 'Aguirre', 'Carrizo', 'Montoya', 'Reutemann', 'Sosa'] },
  { code: 'CA', flag: '🇨🇦', first: ['Liam', 'Nolan', 'Carter', 'Émile', 'Hudson', 'Brock', 'Tanner', 'Gabriel'], last: ['Tremblay', 'Fitzgerald', 'Lachance', 'Brennan', 'Coulter', 'Villeneuve-Roy', 'Marsh', 'Dube'] },
  { code: 'NL', flag: '🇳🇱', first: ['Daan', 'Sem', 'Thijs', 'Bram', 'Joost', 'Rens', 'Milan', 'Sven'], last: ['van der Berg', 'Dekker', 'Vermeulen', 'Bakker', 'Kuipers', 'de Vries', 'Sloot', 'Hendriks'] },
  { code: 'KE', flag: '🇰🇪', first: ['Baraka', 'Jabari', 'Kip', 'Otieno', 'Musa', 'Dedan', 'Njoroge', 'Simeon'], last: ['Mwangi', 'Odhiambo', 'Kiprotich', 'Wafula', 'Karanja', 'Omondi', 'Cheruiyot', 'Gathenji'] },
  { code: 'IN', flag: '🇮🇳', first: ['Arjun', 'Kabir', 'Rohan', 'Vihaan', 'Dev', 'Karan', 'Aditya', 'Nikhil'], last: ['Chandhok', 'Menon', 'Raghavan', 'Bedi', 'Kulkarni', 'Sharma', 'Patil', 'Verma'] },
];

export const TEAM_WORDS_A = ['Apex', 'Vortex', 'Ignition', 'Redline', 'Slipstream', 'Titan', 'Nitro', 'Phantom', 'Ember', 'Quantum', 'Falcon', 'Cobalt', 'Onyx', 'Solar', 'Rogue', 'Delta', 'Hyper', 'Iron', 'Comet', 'Storm'];
export const TEAM_WORDS_B = ['Racing', 'Motorsport', 'GP', 'Works', 'Performance', 'Dynamics', 'Speedworks', 'Factory', 'Crew', 'Garage', 'Syndicate', 'Autosport'];

// Team palettes: three colours — primary accent, secondary accent, and the
// base bodywork colour (what the atlas paints white). Generated so every
// team in a bank is distinct: hues step round the wheel by the golden
// angle, bases cycle through a curated set, and the secondary is either a
// complementary hue or a neutral, keeping contrast against the base.
const BASES = [
  ['#f2f2f2', 'Pearl'], ['#141416', 'Jet'], ['#c8ccd2', 'Silver'], ['#0b1f4b', 'Navy'], ['#f4ead6', 'Cream'],
  ['#3a3d42', 'Gunmetal'], ['#5e0b15', 'Oxblood'], ['#0f3d2e', 'Racing Green'], ['#e8c547', 'Gold'], ['#1b1b2f', 'Midnight'],
  ['#d9d2c5', 'Bone'], ['#2a1a3d', 'Plum'], ['#f7f7f7', 'White'], ['#26262a', 'Carbon'], ['#b8c4cc', 'Ice'],
];
const HUE_NAMES = [[15, 'Crimson'], [40, 'Orange'], [62, 'Amber'], [85, 'Lime'], [150, 'Green'], [175, 'Teal'], [195, 'Cyan'], [225, 'Azure'], [255, 'Blue'], [285, 'Violet'], [320, 'Magenta'], [345, 'Pink'], [361, 'Crimson']];
const hueName = (h) => HUE_NAMES.find(([lim]) => h < lim)[1];
const hsl = (h, s, l) => {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return '#' + [r, g, b].map((v) => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('');
};
const lumOf = (hex) => { const n = parseInt(hex.slice(1), 16); return (0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255; };
export function teamPalette(i) {
  const hue = (i * 137.508 + 8) % 360;
  // hues nearly repeat every 21 teams; alternating light and dark bases
  // keeps two teams that share a hue from looking like one outfit
  const LIGHT = BASES.filter(([hex]) => lumOf(hex) > 0.5), DARK = BASES.filter(([hex]) => lumOf(hex) <= 0.5);
  const pool = i % 2 === 0 ? LIGHT : DARK;
  const [base, baseName] = pool[Math.floor(i / 2) % pool.length];
  const light = lumOf(base) > 0.5;
  // yellows and limes go neon at full saturation: keep them a shade deeper
  const warm = hue > 45 && hue < 110;
  const primary = hsl(hue, warm ? 0.78 : 0.86, light ? (warm ? 0.42 : 0.44) : (warm ? 0.5 : 0.56));
  const mode = i % 3;
  const secondary = mode === 0 ? hsl((hue + 180 + ((i * 53) % 50) - 25 + 360) % 360, 0.8, light ? 0.42 : 0.62) : mode === 1 ? (light ? '#141416' : '#f4f4f4') : hsl((hue + 40) % 360, 0.9, 0.55);
  let name = hueName(hue);
  if (baseName.includes(name)) name = hueName((hue + 40) % 360); // "Racing Green Green" reads badly
  return { colors: [primary, secondary, base], paletteName: `${baseName} ${name}` };
}

export const TEAM_COLORS = [
  ['#e10600', '#ffffff'], ['#0090ff', '#ffd12a'], ['#00d2be', '#111111'], ['#ff8700', '#1b1b2f'],
  ['#9b30ff', '#e8e8e8'], ['#2ecc40', '#0b3d1e'], ['#ffdc00', '#111111'], ['#ff2d95', '#22042f'],
  ['#00c2ff', '#003049'], ['#f5f5f5', '#c1121f'], ['#7fff00', '#233d0a'], ['#ff5714', '#faf3dd'],
  ['#4361ee', '#f1faee'], ['#b5179e', '#f7ede2'], ['#06d6a0', '#073b4c'], ['#e9c46a', '#264653'],
  ['#c0c0c8', '#101020'], ['#8d0801', '#f7b267'], ['#118ab2', '#ffd166'], ['#5f0f40', '#fb8b24'],
];
