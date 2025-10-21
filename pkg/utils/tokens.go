package utils

import (
	"github.com/pkoukk/tiktoken-go"
)

func NumTokensFromMessages(text string) (int, error) {
	tkm, err := tiktoken.EncodingForModel("gpt-4-0613")
	if err != nil {
		return 0, err
	}

	return len(tkm.Encode(text, nil, nil)), nil
}
