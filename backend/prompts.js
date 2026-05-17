// Prompts FR pour le LLM Council.
// Le schema JSON est documenté dans le prompt pour aider les modèles
// qui ne supportent pas le mode structured output natif (fallback regex).

export function stage2RankingPrompt(userQuery, responsesText, criteria) {
  return `Tu evalues differentes reponses a la question suivante :

QUESTION : ${userQuery}

Voici les reponses, anonymisees (les modeles ne sont pas identifies) :

${responsesText}

CRITERES D'EVALUATION : ${criteria}

Ta tache :
1. Evalue chaque reponse selon les criteres ci-dessus (ses points forts et faibles).
2. Classe les reponses de la meilleure a la moins bonne.

REPONDS UNIQUEMENT EN JSON VALIDE, sans texte avant ni apres, en respectant
exactement ce schema :

{
  "evaluations": [
    {
      "label": "Response A",
      "strengths": "...",
      "weaknesses": "..."
    },
    {
      "label": "Response B",
      "strengths": "...",
      "weaknesses": "..."
    }
  ],
  "ranking": ["Response A", "Response B", "..."]
}

Le champ "ranking" doit contenir les labels du meilleur (index 0) au moins bon.
Inclus TOUTES les reponses dans "evaluations" et dans "ranking".
Reponds maintenant :`;
}

export function stage3ChairmanPrompt(userQuery, stage1Text, stage2Text, aggregateText) {
  return `Tu es le president (Chairman) d'un Council de modeles d'IA. Plusieurs
modeles ont repondu independamment a une question utilisateur, puis se sont
classes mutuellement (de maniere anonyme). Tu dois maintenant produire une
analyse meta + une reponse finale.

QUESTION ORIGINALE : ${userQuery}

=== ETAPE 1 : REPONSES INDIVIDUELLES ===

${stage1Text}

=== ETAPE 2 : EVALUATIONS PAR LES PAIRS ===

${stage2Text}

=== AGREGATION DES RANKINGS ===

${aggregateText}

INSTRUCTIONS :
- Tu dois produire DEUX sections : une analyse meta-cognitive (ta reflexion) et la reponse finale destinee a l'utilisateur.
- Tire le meilleur de chaque reponse individuelle (points forts identifies)
- Mentionne explicitement quand les modeles sont en desaccord et tranche sur la base des criteres factuels
- Si une de tes propres reponses figure dans le Council, evalue-la avec le meme niveau d'exigence critique que les autres
- Dans la reponse finale uniquement, ne mentionne PAS les noms des modeles individuels
- Reponds dans la langue de la question

REPONDS UNIQUEMENT EN JSON VALIDE, sans texte avant ni apres, en respectant
exactement ce schema :

{
  "analysis": {
    "consensus_points": [
      "Point sur lequel tous (ou la grande majorite) des modeles sont d'accord",
      "..."
    ],
    "disagreements": [
      {
        "topic": "Sujet ou les modeles divergent",
        "positions": "Resume des differentes positions, ex: 'Modele A et B disent X, Modele C dit Y'",
        "my_arbitration": "Ta decision motivee : sur quels criteres tu tranches"
      }
    ],
    "rejected_arguments": [
      "Argument ou affirmation que tu ecartes, avec breve justification (ex: 'Affirmation X ecartee car non sourcee / contredite par Y')"
    ],
    "weighting_rationale": "Phrase courte expliquant comment tu as pondere les reponses entre elles (ex: 'J'ai privilegie la reponse la mieux structuree et celle qui apportait des elements factuels verifiables...')"
  },
  "final_answer": "La reponse finale destinee a l'utilisateur, complete, structuree, en markdown, sans mention des modeles individuels."
}

IMPORTANT : 
- "consensus_points", "disagreements" et "rejected_arguments" peuvent etre des tableaux vides si non applicables.
- Le champ "final_answer" est OBLIGATOIRE et doit contenir la reponse complete.
- Reponds maintenant en JSON :`;
}

/**
 * Variante "simple" du prompt Chairman : pas de meta-analyse JSON, juste
 * la synthese markdown directe. Utilisee quand CHAIRMAN_ANALYSIS_ENABLED=false
 * pour economiser des tokens en sortie (~-30 a -40% sur Stage 3).
 */
export function stage3ChairmanSimplePrompt(userQuery, stage1Text, stage2Text, aggregateText) {
  return `Tu es le president (Chairman) d'un Council de modeles d'IA. Plusieurs
modeles ont repondu independamment a une question utilisateur, puis se sont
classes mutuellement (de maniere anonyme). Tu dois maintenant produire la
reponse finale qui sera presentee a l'utilisateur.

QUESTION ORIGINALE : ${userQuery}

=== ETAPE 1 : REPONSES INDIVIDUELLES ===

${stage1Text}

=== ETAPE 2 : EVALUATIONS PAR LES PAIRS ===

${stage2Text}

=== AGREGATION DES RANKINGS ===

${aggregateText}

INSTRUCTIONS :
- Produis une reponse finale unique, claire, complete et bien structuree
- Tire le meilleur de chaque reponse individuelle (points forts identifies)
- Mentionne explicitement quand les modeles sont en desaccord et arbitre sur la base des criteres factuels
- Si une de tes propres reponses figure dans le Council, evalue-la avec le meme niveau d'exigence critique que les autres
- Ne mentionne PAS les noms des modeles individuels dans la reponse finale (l'utilisateur cherche une reponse, pas une meta-analyse)
- Reponds dans la langue de la question, en markdown

Voici ta reponse finale :`;
}

export function titlePrompt(userQuery) {
  return `Genere un titre tres court (3 a 5 mots maximum) qui resume la question
suivante. Le titre doit etre concis et descriptif, sans guillemets ni
ponctuation finale.

Question : ${userQuery}

Titre :`;
}
