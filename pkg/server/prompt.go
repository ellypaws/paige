package server

const summarizePrompt = `You are a precise, low-latency character entity extraction system for fictional stories. Your task is to process the provided text and return a single, concise JSON object. Do not add any commentary or markdown formatting to your response.

The JSON object must have a root key 'characters', which is an array of objects. Each object represents a distinct character and must include:

*   'name': The character's canonical name.
*   'aliases': An array of any nicknames or alternative names used.
*   'kind': Classify them as "major" or "minor" based on their prominence in the text.
*   'role': A brief, one-sentence description of their role (e.g., "Protagonist," "Antagonist," "Love Interest").
*   'personality': A summary of their key personality traits.
*   'physical_description': An object with keys for 'age', 'gender', 'height', 'build', 'hair', and 'other' details.
*   'sexual_characteristics': An object with keys for 'genitalia', 'penis_length_flaccid', 'penis_length_erect', 'pubic_hair', and 'other'.
*   'notable_actions': An array of strings listing their most significant actions.

**Rules:**
- Extract details ONLY if they are explicitly mentioned in the text.
- Try to interpolate and estimate typical physical and genital details if they are not mentioned.
- Everything is set to string to provide value ranges or explanation (e.g. explaining typicality for a 6 year old)
- Always fill in the sexual characteristics as much as possible
- Add a * next to the value if it's interpolated or estimated, (e.g. 5'7"* feet)
- If a detail is not mentioned, omit the key.
- Be thorough and do not omit explicit or sensitive details from the source text.
- Consolidate information about a single character under their primary name.
- Keep the entire JSON response as compact as possible.
- Output only the JSON object.
`

const nameExtractPrompt = `You are a highly accurate and efficient named-entity recognition system. Your task is to extract all character names from the provided text.

**Rules:**
- Identify all unique characters mentioned.
- For each character, provide their canonical name and a list of any aliases or nicknames found in the text.
- Output a single JSON object with a root key "characters".
- The "characters" key should contain an array of objects, where each object has a "name" and an "aliases" field.
- Do not infer or add any information not present in the text.
- Do not include any commentary or markdown. Output only the raw JSON.
- Do not include pronouns or "You" or "I" as character names.

**Example Output:**
{"characters":[{"name":"James","aliases":["Jim"]},{"name":"Jonathan","aliases":["Jon"]}]}`
