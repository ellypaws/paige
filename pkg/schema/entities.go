package schema

type Summary struct {
	Characters []Character `json:"characters" jsonschema_description:"List of extracted characters with their attributes and actions"`
	Timeline   []Timeline  `json:"timeline" jsonschema_description:"Chronological sequence of dated events extracted from the story"`
}

type Character struct {
	Name                  string                `json:"name" jsonschema_description:"Canonical character name"`
	Age                   string                `json:"age,omitempty" jsonschema_description:"Age as stated or estimated (use an asterisk if estimated)"`
	Gender                string                `json:"gender,omitempty" jsonschema_description:"Gender as stated or estimated (use an asterisk if estimated)"`
	Aliases               []string              `json:"aliases" jsonschema_description:"Nicknames or alternative names used for this character"`
	Kind                  string                `json:"kind" jsonschema:"enum=main,enum=major,enum=minor" jsonschema_description:"Prominence classification of the character (main, major, or minor)"`
	Role                  string                `json:"role" jsonschema_description:"One-sentence description of the character’s role (e.g., Babysitter, Mom, Love Interest)"`
	Species               string                `json:"species,omitempty" jsonschema_description:"Species if stated or relevant (omit if *all* characters are human or unstated)"`
	Personality           string                `json:"personality" jsonschema_description:"Key personality traits summarized from the text"`
	PhysicalDescription   PhysicalDescription   `json:"physical_description" jsonschema_description:"Physical attributes; mark with an asterisk when interpolated"`
	SexualCharacteristics SexualCharacteristics `json:"sexual_characteristics" jsonschema_description:"Sexual characteristics; fill as much as possible, mark with an asterisk (*) when interpolated"`
	NotableActions        []string              `json:"notable_actions" jsonschema_description:"Most significant actions taken by this character"`
}

type PhysicalDescription struct {
	Height string `json:"height,omitempty" jsonschema_description:"Height as stated or estimated (use an asterisk if estimated)"`
	Build  string `json:"build,omitempty" jsonschema_description:"Body build or physique (e.g., slim, athletic)"`
	Hair   string `json:"hair,omitempty" jsonschema_description:"Hair color/style if stated"`
	Other  string `json:"other,omitempty" jsonschema_description:"Any additional physical details explicitly mentioned"`
}

type SexualCharacteristics struct {
	Genitalia          string  `json:"genitalia,omitempty" jsonschema_description:"Genital description if stated or reasonably estimated"`
	PenisLengthFlaccid *string `json:"penis_length_flaccid,omitempty" jsonschema_description:"Penis length when flaccid if stated or estimated (string to allow ranges/notes)"`
	PenisLengthErect   *string `json:"penis_length_erect,omitempty" jsonschema_description:"Penis length when erect if stated or estimated (string to allow ranges/notes)"`
	PubicHair          string  `json:"pubic_hair,omitempty" jsonschema_description:"Pubic hair description if stated"`
	Other              string  `json:"other,omitempty" jsonschema_description:"Other relevant sexual characteristics explicitly mentioned"`
}

type Timeline struct {
	Date   string  `json:"date" jsonschema_description:"Date of events in 'Month Day, Year' format (e.g., 'June 22, 2009')"`
	Events []Event `json:"events" jsonschema_description:"Events that occurred on this date"`
}

type Event struct {
	Time               string   `json:"time" jsonschema_description:"Time of event (e.g., '7:30am' or 'Morning')"`
	Description        string   `json:"description" jsonschema_description:"Brief description of the event. Make sexual descriptions verbose and tantalizing."`
	CharactersInvolved []string `json:"characters_involved" jsonschema_description:"Character names involved in this event"`
}
