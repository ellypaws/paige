package diff

import (
	"cmp"
	"fmt"
	"io"
	"slices"
	"sort"
	"strings"

	"paige/pkg/schema"
	"paige/pkg/utils"

	"github.com/aryann/difflib"
)

type ChangeType int

const (
	Unchanged ChangeType = iota
	Added
	Removed
	Modified
)

type Op int

const (
	Equal Op = iota
	Insert
	Delete
)

type WordDelta struct {
	Op   Op
	Text string
}

type StringDiff struct {
	Old    string
	New    string
	Deltas []WordDelta
}

type FieldDiff struct {
	Path string
	Str  StringDiff
}

type CharacterDiff struct {
	Name       string
	State      ChangeType
	FieldDiffs []FieldDiff
	NotableAdd []string
	NotableDel []string
	NotableEd  []StringDiff
}

type EventChange struct {
	Date       string
	Key        string
	State      ChangeType
	FieldDiffs []FieldDiff
}

type SummaryDiff struct {
	Characters []CharacterDiff
	Events     []EventChange
}

func Summaries(oldS, newS schema.Summary) SummaryDiff {
	cd := Characters(oldS.Characters, newS.Characters)
	ed := Timelines(oldS.Timeline, newS.Timeline)
	return SummaryDiff{Characters: cd, Events: ed}
}

func Characters(oldC, newC []schema.Character) []CharacterDiff {
	omap := map[string]schema.Character{}
	nmap := map[string]schema.Character{}
	keys := map[string]struct{}{}

	norm := func(s string) string { return strings.ToLower(strings.TrimSpace(s)) }

	for _, c := range oldC {
		k := norm(c.Name)
		omap[k] = c
		keys[k] = struct{}{}
	}
	for _, c := range newC {
		k := norm(c.Name)
		nmap[k] = c
		keys[k] = struct{}{}
	}

	out := make([]CharacterDiff, 0, len(keys))
	for k := range keys {
		o, okO := omap[k]
		n, okN := nmap[k]
		switch {
		case okO && !okN:
			out = append(out, CharacterDiff{Name: o.Name, State: Removed})
		case !okO && okN:
			out = append(out, CharacterDiff{
				Name:  n.Name,
				State: Added,
				FieldDiffs: []FieldDiff{
					{Path: "Age", Str: strEq("", n.Age)},
					{Path: "Gender", Str: strEq("", n.Gender)},
					{Path: "Role", Str: strEq("", n.Role)},
					{Path: "Personality", Str: strEq("", n.Personality)},
					{Path: "PhysicalDescription.Height", Str: strEq("", n.PhysicalDescription.Height)},
					{Path: "PhysicalDescription.Build", Str: strEq("", n.PhysicalDescription.Build)},
					{Path: "PhysicalDescription.Hair", Str: strEq("", n.PhysicalDescription.Hair)},
					{Path: "PhysicalDescription.Other", Str: strEq("", n.PhysicalDescription.Other)},
					{Path: "SexualCharacteristics.Genitalia", Str: strEq("", n.SexualCharacteristics.Genitalia)},
					{Path: "SexualCharacteristics.PubicHair", Str: strEq("", n.SexualCharacteristics.PubicHair)},
					{Path: "SexualCharacteristics.Other", Str: strEq("", n.SexualCharacteristics.Other)},
					{Path: "SexualCharacteristics.PenisLengthFlaccid", Str: strEq("", deref(n.SexualCharacteristics.PenisLengthFlaccid))},
					{Path: "SexualCharacteristics.PenisLengthErect", Str: strEq("", deref(n.SexualCharacteristics.PenisLengthErect))},
				},
				NotableAdd: append([]string(nil), n.NotableActions...),
			})
		default:
			fd := make([]FieldDiff, 0, 12)
			addFieldDiff := func(path, a, b string) {
				if a == b {
					return
				}
				fd = append(fd, FieldDiff{Path: path, Str: strDiff(a, b)})
			}

			addFieldDiff("Age", o.Age, n.Age)
			addFieldDiff("Gender", o.Gender, n.Gender)
			addFieldDiff("Role", o.Role, n.Role)
			addFieldDiff("Personality", o.Personality, n.Personality)
			addFieldDiff("PhysicalDescription.Height", o.PhysicalDescription.Height, n.PhysicalDescription.Height)
			addFieldDiff("PhysicalDescription.Build", o.PhysicalDescription.Build, n.PhysicalDescription.Build)
			addFieldDiff("PhysicalDescription.Hair", o.PhysicalDescription.Hair, n.PhysicalDescription.Hair)
			addFieldDiff("PhysicalDescription.Other", o.PhysicalDescription.Other, n.PhysicalDescription.Other)
			addFieldDiff("SexualCharacteristics.Genitalia", o.SexualCharacteristics.Genitalia, n.SexualCharacteristics.Genitalia)
			addFieldDiff("SexualCharacteristics.PubicHair", o.SexualCharacteristics.PubicHair, n.SexualCharacteristics.PubicHair)
			addFieldDiff("SexualCharacteristics.Other", o.SexualCharacteristics.Other, n.SexualCharacteristics.Other)
			addFieldDiff("SexualCharacteristics.PenisLengthFlaccid", deref(o.SexualCharacteristics.PenisLengthFlaccid), deref(n.SexualCharacteristics.PenisLengthFlaccid))
			addFieldDiff("SexualCharacteristics.PenisLengthErect", deref(o.SexualCharacteristics.PenisLengthErect), deref(n.SexualCharacteristics.PenisLengthErect))

			adds, dels, edits := diffStringListSmart(o.NotableActions, n.NotableActions)

			state := Unchanged
			if len(fd) > 0 || len(adds) > 0 || len(dels) > 0 || len(edits) > 0 {
				state = Modified
			}
			out = append(out, CharacterDiff{
				Name:       n.Name,
				State:      state,
				FieldDiffs: fd,
				NotableAdd: adds,
				NotableDel: dels,
				NotableEd:  edits,
			})
		}
	}
	slices.SortFunc(out, func(a, b CharacterDiff) int { return cmp.Compare(a.Name, b.Name) })
	return out
}

func deref[T any](p *T) string {
	if p == nil {
		return ""
	}
	return fmt.Sprintf("%v", *p)
}

func Timelines(oldT, newT []schema.Timeline) []EventChange {
	omap := map[string]schema.Timeline{}
	nmap := map[string]schema.Timeline{}
	keys := map[string]struct{}{}
	for _, t := range oldT {
		omap[t.Date] = t
		keys[t.Date] = struct{}{}
	}
	for _, t := range newT {
		nmap[t.Date] = t
		keys[t.Date] = struct{}{}
	}
	var out []EventChange
	for date := range keys {
		ot, okO := omap[date]
		nt, okN := nmap[date]
		switch {
		case okO && !okN:
			for _, e := range ot.Events {
				out = append(out, EventChange{Date: date, Key: eventKey(e), State: Removed})
			}
		case !okO && okN:
			for _, e := range nt.Events {
				out = append(out, EventChange{
					Date:  date,
					Key:   eventKey(e),
					State: Added,
					FieldDiffs: []FieldDiff{
						{Path: "Time", Str: strEq("", e.Time)},
						{Path: "Description", Str: strEq("", e.Description)},
					},
				})
			}
		default:
			oUsed := make([]bool, len(ot.Events))
			nUsed := make([]bool, len(nt.Events))

			// pair by exact key first
			for i := range ot.Events {
				ok := eventKey(ot.Events[i])
				for j := range nt.Events {
					if nUsed[j] {
						continue
					}
					if ok == eventKey(nt.Events[j]) {
						fd := eventFieldDiffs(ot.Events[i], nt.Events[j])
						state := Unchanged
						if len(fd) > 0 {
							state = Modified
						}
						out = append(out, EventChange{Date: date, Key: ok, State: state, FieldDiffs: fd})
						oUsed[i], nUsed[j] = true, true
						break
					}
				}
			}
			// fuzzy match by description/time similarity
			for i := range ot.Events {
				if oUsed[i] {
					continue
				}
				bestJ, best := -1, 0.0
				for j := range nt.Events {
					if nUsed[j] {
						continue
					}
					s := max(utils.Similarity(ot.Events[i].Description, nt.Events[j].Description), utils.Similarity(ot.Events[i].Time, nt.Events[j].Time))
					if s > best {
						bestJ, best = j, s
					}
				}
				if bestJ >= 0 && best >= 0.70 {
					fd := eventFieldDiffs(ot.Events[i], nt.Events[bestJ])
					state := Modified
					out = append(out, EventChange{Date: date, Key: eventKey(nt.Events[bestJ]), State: state, FieldDiffs: fd})
					oUsed[i], nUsed[bestJ] = true, true
				}
			}
			// remaining are adds/dels
			for i := range ot.Events {
				if !oUsed[i] {
					out = append(out, EventChange{Date: date, Key: eventKey(ot.Events[i]), State: Removed})
				}
			}
			for j := range nt.Events {
				if !nUsed[j] {
					e := nt.Events[j]
					out = append(out, EventChange{
						Date:  date,
						Key:   eventKey(e),
						State: Added,
						FieldDiffs: []FieldDiff{
							{Path: "Time", Str: strEq("", e.Time)},
							{Path: "Description", Str: strEq("", e.Description)},
						},
					})
				}
			}
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Date == out[j].Date {
			return out[i].Key < out[j].Key
		}
		return out[i].Date < out[j].Date
	})
	return out
}

func eventKey(e schema.Event) string {
	k := strings.TrimSpace(e.Time) + "|" + strings.TrimSpace(e.Description)
	if strings.TrimSpace(k) == "|" {
		return "(blank)"
	}
	return k
}

func eventFieldDiffs(a, b schema.Event) []FieldDiff {
	var fd []FieldDiff
	if a.Time != b.Time {
		fd = append(fd, FieldDiff{Path: "Time", Str: strDiff(a.Time, b.Time)})
	}
	if a.Description != b.Description {
		fd = append(fd, FieldDiff{Path: "Description", Str: strDiff(a.Description, b.Description)})
	}
	return fd
}

func strEq(a, b string) StringDiff {
	return StringDiff{Old: a, New: b, Deltas: []WordDelta{{Op: Insert, Text: b}}}
}

func strDiff(a, b string) StringDiff {
	if a == b {
		return StringDiff{Old: a, New: b, Deltas: []WordDelta{{Op: Equal, Text: a}}}
	}
	at := utils.TokenizeWords(a)
	bt := utils.TokenizeWords(b)
	recs := difflib.Diff(at, bt)
	deltas := make([]WordDelta, 0, len(recs))
	for _, r := range recs {
		switch r.Delta {
		case difflib.Common:
			deltas = append(deltas, WordDelta{Op: Equal, Text: r.Payload})
		case difflib.LeftOnly:
			deltas = append(deltas, WordDelta{Op: Delete, Text: r.Payload})
		case difflib.RightOnly:
			deltas = append(deltas, WordDelta{Op: Insert, Text: r.Payload})
		}
	}
	return StringDiff{Old: a, New: b, Deltas: coalesceSpaces(deltas)}
}

func coalesceSpaces(in []WordDelta) []WordDelta {
	out := make([]WordDelta, 0, len(in))
	flush := func(op Op, buf *strings.Builder) {
		if buf.Len() == 0 {
			return
		}
		out = append(out, WordDelta{Op: op, Text: buf.String()})
		buf.Reset()
	}
	var curOp Op = -1
	var buf strings.Builder
	for _, d := range in {
		if strings.TrimSpace(d.Text) == "" && d.Op == Equal {
			buf.WriteString(d.Text)
			continue
		}
		if curOp != d.Op && curOp != -1 {
			flush(curOp, &buf)
		}
		if curOp != d.Op {
			curOp = d.Op
		}
		buf.WriteString(d.Text)
	}
	flush(curOp, &buf)
	return out
}

func diffStringListSmart(a, b []string) (adds, dels []string, edits []StringDiff) {
	usedB := make([]bool, len(b))
	for _, as := range a {
		bestJ, best := -1, 0.0
		for j, bs := range b {
			if usedB[j] {
				continue
			}
			s := utils.Similarity(as, bs)
			if s > best {
				bestJ, best = j, s
			}
		}
		if bestJ >= 0 && best >= 0.70 {
			if as != b[bestJ] {
				edits = append(edits, strDiff(as, b[bestJ]))
			}
			usedB[bestJ] = true
		} else {
			dels = append(dels, as)
		}
	}
	for j, bs := range b {
		if !usedB[j] {
			adds = append(adds, bs)
		}
	}
	return
}

const (
	ansiReset = "\x1b[0m"
	fgGreen   = "\x1b[32m"
	fgRed     = "\x1b[31m"
	fgYellow  = "\x1b[33m"
	fgCyan    = "\x1b[36m"
	faint     = "\x1b[2m"
	uline     = "\x1b[4m"
	strike    = "\x1b[9m"
)

func renderStringDiff(sd StringDiff) string {
	var b strings.Builder
	for _, d := range sd.Deltas {
		switch d.Op {
		case Equal:
			b.WriteString(d.Text)
		case Insert:
			fmt.Fprintf(&b, "%s%s%s%s", fgGreen, uline, d.Text, ansiReset)
		case Delete:
			fmt.Fprintf(&b, "%s%s%s%s", fgRed, strike, d.Text, ansiReset)
		}
	}
	return b.String()
}

func (d SummaryDiff) Print(w io.Writer) {
	if len(d.Characters) > 0 {
		fmt.Fprintln(w, fgCyan+"Characters"+ansiReset)
		for _, c := range d.Characters {
			tag := map[ChangeType]string{
				Added:     fgGreen + "[+]" + ansiReset,
				Removed:   fgRed + "[-]" + ansiReset,
				Modified:  fgYellow + "[~]" + ansiReset,
				Unchanged: faint + "[=]" + ansiReset,
			}[c.State]
			fmt.Fprintf(w, "  %s %s\n", tag, c.Name)
			for _, f := range c.FieldDiffs {
				fmt.Fprintf(w, "    %s: %s\n", f.Path, renderStringDiff(f.Str))
			}
			for _, s := range c.NotableDel {
				fmt.Fprintf(w, "    Notable: %s%s%s%s\n", fgRed, strike, s, ansiReset)
			}
			for _, s := range c.NotableAdd {
				fmt.Fprintf(w, "    Notable: %s%s%s%s\n", fgGreen, uline, s, ansiReset)
			}
			for _, sd := range c.NotableEd {
				fmt.Fprintf(w, "    Notable*: %s\n", renderStringDiff(sd))
			}
		}
	}
	if len(d.Events) > 0 {
		fmt.Fprintln(w, fgCyan+"Events"+ansiReset)
		curDate := ""
		for _, e := range d.Events {
			if e.Date != curDate {
				curDate = e.Date
				fmt.Fprintf(w, "  %s%s%s\n", faint, curDate, ansiReset)
			}
			tag := map[ChangeType]string{
				Added:     fgGreen + "[+]" + ansiReset,
				Removed:   fgRed + "[-]" + ansiReset,
				Modified:  fgYellow + "[~]" + ansiReset,
				Unchanged: faint + "[=]" + ansiReset,
			}[e.State]
			fmt.Fprintf(w, "    %s %s\n", tag, e.Key)
			for _, f := range e.FieldDiffs {
				fmt.Fprintf(w, "      %s: %s\n", f.Path, renderStringDiff(f.Str))
			}
		}
	}
}
