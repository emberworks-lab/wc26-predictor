/**
 * Static star-player suggestion list for the Fun challenge Golden Ball and Golden Boot pickers.
 *
 * Purpose / usage notes:
 * - This is a static fallback source. The live `scorers_cache` table is sparse early in the
 *   tournament (Round of 48 has just started), so autocomplete falls back to this list.
 * - Names should match the spelling admins will later enter as the correct answer so that
 *   string-comparison scoring works without normalisation. Use the spelling from
 *   football-data.org / common English media (diacritics kept, e.g. "Mbappé", "Vinícius Júnior").
 * - Sorted by `team` (ISO/FIFA three-letter code), then by `name` within each team.
 * - Plain data file — no logic, no imports.
 */

export interface FunPlayerSuggestion {
  /** Display + stored name, common Latin spelling with diacritics (e.g. "Kylian Mbappé"). */
  name: string;
  /** FIFA three-letter code of the player's national team, e.g. "FRA". */
  team: string;
}

/** Static star-player suggestions for the Fun challenge Golden Ball / Boot pickers. */
export const FUN_PLAYER_SUGGESTIONS: readonly FunPlayerSuggestion[] = [
  // ARG — Argentina
  { name: 'Alejandro Garnacho', team: 'ARG' },
  { name: 'Enzo Fernández', team: 'ARG' },
  { name: 'Julian Álvarez', team: 'ARG' },
  { name: 'Lautaro Martínez', team: 'ARG' },
  { name: 'Lionel Messi', team: 'ARG' },
  { name: 'Rodrigo De Paul', team: 'ARG' },

  // AUS — Australia
  { name: 'Mathew Ryan', team: 'AUS' },
  { name: 'Mitchell Duke', team: 'AUS' },

  // AUT — Austria
  { name: 'Christoph Baumgartner', team: 'AUT' },
  { name: 'Marcel Sabitzer', team: 'AUT' },
  { name: 'Marko Arnautović', team: 'AUT' },

  // BEL — Belgium
  { name: 'Amadou Onana', team: 'BEL' },
  { name: 'Jeremy Doku', team: 'BEL' },
  { name: 'Lois Openda', team: 'BEL' },
  { name: 'Romelu Lukaku', team: 'BEL' },

  // BRA — Brazil
  { name: 'Endrick', team: 'BRA' },
  { name: 'Raphinha', team: 'BRA' },
  { name: 'Rodrygo', team: 'BRA' },
  { name: 'Vinícius Júnior', team: 'BRA' },
  { name: 'Gabriel Martinelli', team: 'BRA' },
  { name: 'Marquinhos', team: 'BRA' },

  // CAN — Canada
  { name: 'Alphonso Davies', team: 'CAN' },
  { name: 'Jonathan David', team: 'CAN' },
  { name: 'Tajon Buchanan', team: 'CAN' },

  // COL — Colombia
  { name: 'James Rodríguez', team: 'COL' },
  { name: 'Luis Díaz', team: 'COL' },
  { name: 'Rafael Santos Borré', team: 'COL' },
  { name: 'Richard Ríos', team: 'COL' },

  // CRO — Croatia
  { name: 'Ivan Perišić', team: 'CRO' },
  { name: 'Luka Modrić', team: 'CRO' },
  { name: 'Mateo Kovačić', team: 'CRO' },

  // DEN — Denmark
  { name: 'Christian Eriksen', team: 'DEN' },
  { name: 'Rasmus Højlund', team: 'DEN' },
  { name: 'Viktor Gyökeres', team: 'DEN' },

  // ECU — Ecuador
  { name: 'Enner Valencia', team: 'ECU' },
  { name: 'Kendry Páez', team: 'ECU' },

  // EGY — Egypt
  { name: 'Mohamed Salah', team: 'EGY' },
  { name: 'Omar Marmoush', team: 'EGY' },

  // ENG — England
  { name: 'Bukayo Saka', team: 'ENG' },
  { name: 'Cole Palmer', team: 'ENG' },
  { name: 'Declan Rice', team: 'ENG' },
  { name: 'Harry Kane', team: 'ENG' },
  { name: 'Jude Bellingham', team: 'ENG' },
  { name: 'Phil Foden', team: 'ENG' },

  // ESP — Spain
  { name: 'Dani Olmo', team: 'ESP' },
  { name: 'Fabián Ruiz', team: 'ESP' },
  { name: 'Ferran Torres', team: 'ESP' },
  { name: 'Lamine Yamal', team: 'ESP' },
  { name: 'Nico Williams', team: 'ESP' },
  { name: 'Pedri', team: 'ESP' },

  // FRA — France
  { name: 'Antoine Griezmann', team: 'FRA' },
  { name: 'Aurélien Tchouaméni', team: 'FRA' },
  { name: 'Kylian Mbappé', team: 'FRA' },
  { name: 'Marcus Thuram', team: 'FRA' },
  { name: 'Ousmane Dembélé', team: 'FRA' },
  { name: 'William Saliba', team: 'FRA' },

  // GER — Germany
  { name: 'Florian Wirtz', team: 'GER' },
  { name: 'Jamal Musiala', team: 'GER' },
  { name: 'Kai Havertz', team: 'GER' },
  { name: 'Leroy Sané', team: 'GER' },
  { name: 'Thomas Müller', team: 'GER' },
  { name: 'Toni Kroos', team: 'GER' },

  // GHA — Ghana
  { name: 'Mohammed Kudus', team: 'GHA' },
  { name: 'Thomas Partey', team: 'GHA' },

  // HUN — Hungary (qualified for WC2026)
  { name: 'Dominik Szoboszlai', team: 'HUN' },
  { name: 'Roland Sallai', team: 'HUN' },

  // IRN — Iran
  { name: 'Mehdi Taremi', team: 'IRN' },
  { name: 'Sardar Azmoun', team: 'IRN' },

  // JPN — Japan
  { name: 'Ayase Ueda', team: 'JPN' },
  { name: 'Kaoru Mitoma', team: 'JPN' },
  { name: 'Ritsu Doan', team: 'JPN' },
  { name: 'Takefusa Kubo', team: 'JPN' },

  // KOR — South Korea
  { name: 'Heung-min Son', team: 'KOR' },
  { name: 'Lee Kang-in', team: 'KOR' },
  { name: 'Oh Hyeon-gyu', team: 'KOR' },

  // KSA — Saudi Arabia
  { name: 'Firas Al-Buraikan', team: 'KSA' },
  { name: 'Salem Al-Dawsari', team: 'KSA' },

  // MAR — Morocco
  { name: 'Achraf Hakimi', team: 'MAR' },
  { name: 'Hakim Ziyech', team: 'MAR' },
  { name: 'Youssef En-Nesyri', team: 'MAR' },

  // MEX — Mexico
  { name: 'Edson Álvarez', team: 'MEX' },
  { name: 'Hirving Lozano', team: 'MEX' },
  { name: 'Santiago Giménez', team: 'MEX' },

  // NED — Netherlands
  { name: 'Cody Gakpo', team: 'NED' },
  { name: 'Memphis Depay', team: 'NED' },
  { name: 'Ryan Gravenberch', team: 'NED' },
  { name: 'Virgil van Dijk', team: 'NED' },
  { name: 'Xavi Simons', team: 'NED' },

  // NGA — Nigeria
  { name: 'Ademola Lookman', team: 'NGA' },
  { name: 'Victor Osimhen', team: 'NGA' },

  // NOR — Norway
  { name: 'Erling Haaland', team: 'NOR' },
  { name: 'Martin Ødegaard', team: 'NOR' },

  // POR — Portugal
  { name: 'Bruno Fernandes', team: 'POR' },
  { name: 'Cristiano Ronaldo', team: 'POR' },
  { name: 'Diogo Jota', team: 'POR' },
  { name: 'Pedro Neto', team: 'POR' },
  { name: 'Rafael Leão', team: 'POR' },
  { name: 'Rúben Dias', team: 'POR' },

  // SEN — Senegal
  { name: 'Idrissa Gana Gueye', team: 'SEN' },
  { name: 'Ismaïla Sarr', team: 'SEN' },
  { name: 'Sadio Mané', team: 'SEN' },

  // SUI — Switzerland
  { name: 'Breel Embolo', team: 'SUI' },
  { name: 'Granit Xhaka', team: 'SUI' },
  { name: 'Xherdan Shaqiri', team: 'SUI' },

  // URU — Uruguay
  { name: 'Darwin Núñez', team: 'URU' },
  { name: 'Federico Valverde', team: 'URU' },
  { name: 'Rodrigo Bentancur', team: 'URU' },
  { name: 'Ronald Araújo', team: 'URU' },

  // USA — United States
  { name: 'Christian Pulisic', team: 'USA' },
  { name: 'Folarin Balogun', team: 'USA' },
  { name: 'Giovanni Reyna', team: 'USA' },
  { name: 'Ricardo Pepi', team: 'USA' },
  { name: 'Tyler Adams', team: 'USA' },
];
