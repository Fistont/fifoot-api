const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

exports.handler = async function (event, context) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS' ) {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const params = event.queryStringParameters || {};
    
    let targetDate = params.date || new Date().toISOString().split('T')[0];

    // 1. Fetch matches from your Supabase
    const { data: dbMatches, error } = await supabase
      .from('matches')
      .select(`
        id, match_date, local_date, status_short, status_elapsed,
        home_goals, away_goals, stream_url,
        home_team:teams!matches_home_team_id_fkey (name),
        away_team:teams!matches_away_team_id_fkey (name)
      `)
      .eq('local_date', targetDate)
      .order('match_date', { ascending: true });

    if (error) throw error;

    // 2. Fetch real-time scores
    let liveData = [];
    try {
        const response = await fetch('https://worldcup26.ir/get/games' );
        if (response.ok) {
            const json = await response.json();
            liveData = json.games || [];
        }
    } catch (e) {}

    // 3. Smart Merge Logic
    const formattedMatches = (dbMatches || []).map((dbMatch) => {
      const liveGame = liveData.find(g => 
        (g.home_team_name_en || "").toLowerCase().includes(dbMatch.home_team.name.toLowerCase()) &&
        (g.away_team_name_en || "").toLowerCase().includes(dbMatch.away_team.name.toLowerCase())
      );

      let status = dbMatch.status_short || 'NS';
      let elapsed = dbMatch.status_elapsed || '';
      let homeGoals = dbMatch.home_goals || 0;
      let awayGoals = dbMatch.away_goals || 0;

      if (liveGame) {
          // SUPER-DETECTION: If not finished and not "notstarted", it's LIVE!
          if (liveGame.finished === "TRUE") {
              status = 'FT';
          } else if (liveGame.time_elapsed && liveGame.time_elapsed.toLowerCase() !== 'notstarted') {
              status = 'LIVE';
              elapsed = liveGame.time_elapsed === 'half-time' ? 'HT' : (liveGame.time_elapsed === 'live' ? '' : liveGame.time_elapsed);
          }
          homeGoals = liveGame.home_score ?? homeGoals;
          awayGoals = liveGame.away_score ?? awayGoals;
      }

      return {
        id: dbMatch.id,
        date: dbMatch.match_date,
        status: { short: status, elapsed: elapsed },
        teams: {
          home: { name: dbMatch.home_team.name, logo: `https://flagsapi.com/${getCountryCode(dbMatch.home_team.name )}/flat/64.png` }, // Fallback logo logic
          away: { name: dbMatch.away_team.name, logo: `https://flagsapi.com/${getCountryCode(dbMatch.away_team.name )}/flat/64.png` }
        },
        goals: { home: homeGoals, away: awayGoals },
        stream_url: dbMatch.stream_url,
      };
    });

    return { statusCode: 200, headers, body: JSON.stringify({ date: targetDate, matches: formattedMatches }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};

// Helper to keep logos working even if database has issues
function getCountryCode(name) {
    const codes = {'Mexico':'MX','South Africa':'ZA','South Korea':'KR','Czech Republic':'CZ','Canada':'CA','Bosnia':'BA','USA':'US','Paraguay':'PY','Haiti':'HT','Scotland':'GB-SCT','Australia':'AU','Turkey':'TR','Brazil':'BR','Morocco':'MA','Qatar':'QA','Switzerland':'CH','Ivory Coast':'CI','Ecuador':'EC','Germany':'DE','Curaçao':'CW','Netherlands':'NL','Japan':'JP','Sweden':'SE','Tunisia':'TN','Iran':'IR','New Zealand':'NZ','Spain':'ES','Cape Verde':'CV','Belgium':'BE','Egypt':'EG','Saudi Arabia':'SA','Uruguay':'UY','France':'FR','Senegal':'SN','Italy':'IT','DR Congo':'CD'};
    return codes[name] || 'UN';
}
