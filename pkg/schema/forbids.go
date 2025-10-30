package schema

import (
	"encoding/json"
	"errors"
)

type Forbids struct {
	Reason     string `json:"reason"`
	Text       string `json:"text"`
	Compressed string `json:"compressed,omitzero"`

	Error error  `json:"-"`
	Raw   string `json:"raw,omitzero"`
}

type alias struct {
	Reason     string `json:"reason"`
	Text       string `json:"text"`
	Compressed string `json:"compressed,omitzero"`
	Error      string `json:"error,omitzero"`
	Raw        string `json:"raw,omitzero"`
}

func (f *Forbids) MarshalJSON() ([]byte, error) {
	if f == nil {
		return nil, nil
	}

	a := alias{
		Reason:     f.Reason,
		Text:       f.Text,
		Compressed: f.Compressed,
		Raw:        f.Raw,
	}
	if f.Error != nil {
		a.Error = f.Error.Error()
	}

	return json.Marshal(a)
}

func (f *Forbids) UnmarshalJSON(data []byte) error {
	var a alias
	if err := json.Unmarshal(data, &a); err != nil {
		return err
	}

	f.Reason = a.Reason
	f.Text = a.Text
	f.Compressed = a.Compressed
	if a.Error != "" {
		f.Error = errors.New(a.Error)
	}
	f.Raw = a.Raw

	return nil
}
