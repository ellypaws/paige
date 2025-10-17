package entities

type Summary struct {
	Characters []Character `json:"characters"`
	Timeline   []Timeline  `json:"timeline"`
}

type Character struct {
	Name                  string                `json:"name"`
	Age                   string                `json:"age"`
	Gender                string                `json:"gender"`
	Role                  string                `json:"role"`
	PhysicalDescription   PhysicalDescription   `json:"physical_description"`
	SexualCharacteristics SexualCharacteristics `json:"sexual_characteristics"`
	Personality           string                `json:"personality"`
	NotableActions        []string              `json:"notable_actions"`
}

type PhysicalDescription struct {
	Height string `json:"height"`
	Build  string `json:"build"`
	Hair   string `json:"hair"`
	Other  string `json:"other"`
}

type SexualCharacteristics struct {
	Genitalia          string  `json:"genitalia"`
	PenisLengthFlaccid *string `json:"penis_length_flaccid,omitempty"`
	PenisLengthErect   *string `json:"penis_length_erect,omitempty"`
	PubicHair          string  `json:"pubic_hair"`
	Other              string  `json:"other"`
}

type Timeline struct {
	Date   string  `json:"date"`
	Events []Event `json:"events"`
}

type Event struct {
	Time        string `json:"time"`
	Description string `json:"description"`
}
