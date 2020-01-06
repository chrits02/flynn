import * as React from 'react';

import { Checkmark as CheckmarkIcon, Copy as CopyIcon, StatusWarning as WarningIcon } from 'grommet-icons';
import { Box, Button } from 'grommet';
import Notification from '../Notification';
import copyToClipboard from '../util/copyToClipboard';
import {
	Data,
	DataActionType,
	Entry,
	hasKey as hasDataKey,
	hasIndex as hasDataIndex,
	nextIndex as nextDataIndex,
	setValueAtIndex,
	appendEntry,
	getEntries,
	mapEntries,
	MapEntriesOption
} from './Data';
import { Action, ActionType } from './common';
import { SearchInput } from './SearchInput';
import { InputSelection } from './Input';
import { Row, Selection, Suggestion } from './Row';

type DataCallback = (data: Data) => void;

export interface Props {
	data: Data;
	dispatch: (action: Action) => void;
	keyPlaceholder?: string;
	valuePlaceholder?: string;
	submitLabel?: string;
	conflictsMessage?: string;
	copyButtonTitle?: string;
	suggestions?: Suggestion[];
}

function parsePairs(str: string): Iterable<[string, string]> {
	let offset = 0;
	let len = str.length;
	return {
		*[Symbol.iterator]() {
			let key = '';
			let val = '';
			let i = offset;
			while (offset < len) {
				while (str.slice(i++)[0] !== '=') {
					if (i === len) return;
					key = str.slice(offset, i);
				}
				offset = i;
				if (str.slice(i)[0] === '"') {
					i++;
					offset++;
					while (!(str.slice(i++)[0] === '"' && str.slice(i - 2)[0] !== '\\')) {
						if (i === len) return;
						val = str.slice(offset, i);
					}
					val = val.replace(/\\"/g, '"'); // unescape quotes (e.g. JSON)
				} else {
					while (str.slice(i++)[0] !== '\n') {
						val = str.slice(offset, i);
						if (i === len) break;
					}
				}
				offset = i;
				yield [
					key.trim(),
					val.trim().replace(/\\n/g, '\n') // unescape newlines
				] as [string, string];
			}
		}
	};
}

function Editor({
	data,
	dispatch,
	keyPlaceholder = 'Key',
	valuePlaceholder = 'Value',
	submitLabel = 'Review Changes',
	conflictsMessage = 'Some entries have conflicts',
	copyButtonTitle = 'Copy data to clipboard',
	suggestions = []
}: Props) {
	const hasConflicts = React.useMemo(() => (data.conflicts || []).length > 0, [data.conflicts]);

	const [selectedSuggestion, setSelectedSuggestion] = React.useState<Suggestion | null>(null);
	const [keyInputSuggestions, setKeyInputSuggestions] = React.useState<string[]>([]);
	React.useEffect(
		() => {
			const nextKeyInputSuggestions = suggestions.reduce((m: string[], s: Suggestion) => {
				if (hasDataKey(data, s.key)) return m;
				return m.concat(s.key);
			}, [] as string[]);
			if (
				nextKeyInputSuggestions.find((s: string, index: number) => {
					return keyInputSuggestions[index] !== s;
				})
			) {
				// only trigger a re-render if the suggestions changed
				setKeyInputSuggestions(nextKeyInputSuggestions);
			}
		},
		[suggestions, data] // eslint-disable-line react-hooks/exhaustive-deps
	);

	const inputs = React.useMemo(
		() => {
			return {
				currentSelection: null as Selection | null,
				refs: [] as [HTMLInputElement | HTMLTextAreaElement | null, HTMLInputElement | HTMLTextAreaElement | null][]
			};
		},
		[] // eslint-disable-line react-hooks/exhaustive-deps
	);
	inputs.refs = [];
	const setCurrentSelection = React.useCallback(
		(s: Selection | null) => {
			inputs.currentSelection = s;
		},
		[] // eslint-disable-line react-hooks/exhaustive-deps
	);

	// focus next entry's input when entry deleted
	React.useLayoutEffect(
		() => {
			if (!inputs.currentSelection) return;
			const { entryIndex, entryInnerIndex } = inputs.currentSelection;
			if (!hasDataIndex(data, entryIndex)) {
				// focus next input down when entry removed
				const nextIndex = nextDataIndex(data, entryIndex);
				const ref = (inputs.refs[nextIndex] || [])[entryInnerIndex];
				if (ref) {
					const length = ref.value.length;
					const selectionStart = length;
					const selectionEnd = length;
					const selectionDirection = 'forward';
					ref.focus();
					ref.setSelectionRange(selectionStart, selectionEnd, selectionDirection);
				}
			} else {
				// maintain current focus/selection
				// ref.value isn't set yet if we don't use setTimeout [TODO(jvatic): figure out why]
				setTimeout(() => {
					const ref = (inputs.refs[entryIndex] || [])[entryInnerIndex];
					if (ref && inputs.currentSelection) {
						const { selectionStart, selectionEnd, direction } = inputs.currentSelection;
						ref.focus();
						ref.setSelectionRange(selectionStart, selectionEnd, direction);
					}
				}, 10);
			}
		},
		[data] // eslint-disable-line react-hooks/exhaustive-deps
	);

	const keyChangeHandler = React.useCallback(
		(entryIndex: number, key: string) => {
			dispatch({ type: DataActionType.SET_KEY_AT_INDEX, key, index: entryIndex });
			const s = suggestions.find((s) => s.key === key);
			if (s) {
				dispatch({ type: DataActionType.SET_VAL_AT_INDEX, value: s.valueTemplate.value, index: entryIndex });
				const { selectionStart, selectionEnd, direction } = s.valueTemplate;
				const valueInput = (inputs.refs[entryIndex] || [])[1];
				if (valueInput) {
					valueInput.value = s.valueTemplate.value;
					setCurrentSelection({
						entryIndex,
						entryInnerIndex: 1,
						selectionStart,
						selectionEnd,
						direction
					});
				}
				setSelectedSuggestion(s);
			}
		},
		[dispatch, inputs.refs, setCurrentSelection, suggestions]
	);

	const valueChangeHandler = React.useCallback(
		(index: number, value: string) => {
			dispatch({ type: DataActionType.SET_VAL_AT_INDEX, value, index });
		},
		[dispatch]
	);

	const inputBlurHandler = React.useCallback(
		(entryIndex: number, entryInnerIndex: number, e: React.SyntheticEvent) => {
			if (
				inputs.currentSelection &&
				inputs.currentSelection.entryIndex === entryIndex &&
				inputs.currentSelection.entryInnerIndex === entryInnerIndex
			) {
				setCurrentSelection(null);
			}
		},
		[inputs.currentSelection, setCurrentSelection]
	);

	const selectionChangeHandler = React.useCallback(
		(entryIndex: number, entryInnerIndex: 0 | 1, selection: InputSelection) => {
			setCurrentSelection({
				entryIndex,
				entryInnerIndex,
				...selection
			});
		},
		[setCurrentSelection]
	);

	const inputRefHandler = React.useCallback(
		(entryIndex: number, entryInnerIndex: 0 | 1, ref: any) => {
			let entryRefs = inputs.refs[entryIndex] || [null, null];
			if (entryInnerIndex === 0) {
				entryRefs = [ref as HTMLInputElement | HTMLTextAreaElement | null, entryRefs[1]];
			} else {
				entryRefs = [entryRefs[0], ref as HTMLInputElement | HTMLTextAreaElement | null];
			}
			inputs.refs[entryIndex] = entryRefs;
		},
		[inputs.refs]
	);

	const handlePaste = React.useCallback(
		(entryIndex: number, entryInnerIndex: number, event: React.ClipboardEvent) => {
			// Detect key=value paste
			const text = event.clipboardData.getData('text/plain');
			if (text.match(/^(\S+=[^=]+\n?)+$/)) {
				let nextData = data;
				event.preventDefault();
				for (const [key, val] of parsePairs(text.trim())) {
					nextData = appendEntry(nextData, key, val);
				}
				dispatch({ type: ActionType.SET_DATA, data: nextData });
			} else if (entryInnerIndex === 1 && text.indexOf('\n') >= 0) {
				event.preventDefault();

				// make sure input expands into textarea
				const ref = (inputs.refs[entryIndex] || [])[entryInnerIndex];
				if (ref) {
					ref.blur();
				}
				setCurrentSelection({
					entryIndex,
					entryInnerIndex,
					selectionStart: text.length,
					selectionEnd: text.length,
					direction: 'forward'
				});

				const nextData = setValueAtIndex(data, text.replace(/\\n/g, '\n'), entryIndex);
				dispatch({ type: ActionType.SET_DATA, data: nextData });
			}
		},
		[data, dispatch, inputs.refs, setCurrentSelection]
	);

	const handleCopyButtonClick = React.useCallback(
		(event: React.SyntheticEvent) => {
			event.preventDefault();

			const text = getEntries(data)
				.map(([key, val]: [string, string]) => {
					if (val.indexOf('\n') > -1) {
						if (val.indexOf('"')) {
							// escape existing quotes (e.g. JSON)
							val = `${val.replace(/"/g, '\\"')}`;
						}
						// wrap multiline values in quotes
						val = `"${val.replace(/\n/g, '\\n')}"`;
					}
					return `${key}=${val}`;
				})
				.join('\n');

			copyToClipboard(text);
		},
		[data]
	);

	return (
		<form
			onSubmit={(e: React.SyntheticEvent) => {
				e.preventDefault();
				dispatch({ type: ActionType.SUBMIT_DATA, data: data });
			}}
		>
			<Box direction="column" gap="xsmall">
				{hasConflicts ? <Notification status="warning" message={conflictsMessage} /> : null}
				<SearchInput dispatch={dispatch} />
				{mapEntries(
					data,
					(entry: Entry, index: number) => {
						return (
							<Box key={index} direction="row" gap="xsmall">
								<Row
									key={index}
									refHandler={inputRefHandler}
									keyPlaceholder={keyPlaceholder}
									valuePlaceholder={valuePlaceholder}
									entry={entry}
									index={index}
									onKeyChange={keyChangeHandler}
									onValueChange={valueChangeHandler}
									onBlur={inputBlurHandler}
									onSelectionChange={selectionChangeHandler}
									keyInputSuggestions={keyInputSuggestions}
									selectedKeySuggestion={selectedSuggestion}
									onKeySuggestionSelect={keyChangeHandler}
									onPaste={handlePaste}
								/>
							</Box>
						);
					},
					MapEntriesOption.APPEND_EMPTY_ENTRY
				)}
			</Box>
			<Button
				disabled={!data.hasChanges}
				type="submit"
				primary
				icon={hasConflicts ? <WarningIcon /> : <CheckmarkIcon />}
				label={submitLabel}
			/>
			&nbsp;
			<Button title={copyButtonTitle} type="button" icon={<CopyIcon />} onClick={handleCopyButtonClick} />
		</form>
	);
}
export default React.memo(Editor);

(Editor as any).whyDidYouRender = true;
