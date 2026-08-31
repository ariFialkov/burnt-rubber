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

export const TEAM_COLORS = [
  ['#e10600', '#ffffff'], ['#0090ff', '#ffd12a'], ['#00d2be', '#111111'], ['#ff8700', '#1b1b2f'],
  ['#9b30ff', '#e8e8e8'], ['#2ecc40', '#0b3d1e'], ['#ffdc00', '#111111'], ['#ff2d95', '#22042f'],
  ['#00c2ff', '#003049'], ['#f5f5f5', '#c1121f'], ['#7fff00', '#233d0a'], ['#ff5714', '#faf3dd'],
  ['#4361ee', '#f1faee'], ['#b5179e', '#f7ede2'], ['#06d6a0', '#073b4c'], ['#e9c46a', '#264653'],
  ['#c0c0c8', '#101020'], ['#8d0801', '#f7b267'], ['#118ab2', '#ffd166'], ['#5f0f40', '#fb8b24'],
];
