import * as React from 'react';
import * as jspb from 'google-protobuf';
import { Checkmark as CheckmarkIcon } from 'grommet-icons';
import { Box, Button } from 'grommet';
import useApp from './useApp';
import useClient from './useClient';
import useWithCancel from './useWithCancel';
import useNavProtection from './useNavProtection';
import useErrorHandler from './useErrorHandler';
import Loading from './Loading';
import KeyValueEditor, {
	Data,
	Action as KVEditorAction,
	ActionType as KVEditorActionType,
	Suggestion,
	dataReducer,
	buildData,
	rebaseData,
	getEntries
} from './KeyValueEditor';
import KeyValueDiff from './KeyValueDiff';
import protoMapReplace from './util/protoMapReplace';
import { App } from './generated/controller_pb';
import RightOverlay from './RightOverlay';

interface Props {
	appName: string;
}

interface State {
	dataInitialized: boolean;
	data: Data;
	isConfirming: boolean;
	isDeploying: boolean;
}

function initialState(props: Props): State {
	return {
		dataInitialized: false,
		data: buildData([]),
		isConfirming: false,
		isDeploying: false
	};
}

enum ActionType {
	INIT_DATA = 'INIT_DATA',
	DEPLOY = 'DEPLOY',
	DEPLOY_ERROR = 'DEPLOY_ERROR',
	DEPLOY_SUCCESS = 'DEPLOY_SUCCESS',
	CONFIRM_CANCEL = 'CONFIRM_CANCEL'
}

interface InitDataAction {
	type: ActionType.INIT_DATA;
	data: Data;
}

interface DeployAction {
	type: ActionType.DEPLOY;
}

interface DeployErrorAction {
	type: ActionType.DEPLOY_ERROR;
	error: Error;
}

interface DeploySuccessAction {
	type: ActionType.DEPLOY_SUCCESS;
	data: Data;
}

interface ConfirmCancelAction {
	type: ActionType.CONFIRM_CANCEL;
}

type Action =
	| InitDataAction
	| DeployAction
	| DeployErrorAction
	| DeploySuccessAction
	| ConfirmCancelAction
	| KVEditorAction;

function reducer(prevState: State, action: Action): State {
	const nextState = Object.assign({}, prevState);
	switch (action.type) {
		case ActionType.INIT_DATA:
			nextState.data = action.data;
			nextState.dataInitialized = true;
			break;
		case ActionType.DEPLOY:
			nextState.isDeploying = true;
			break;
		case ActionType.DEPLOY_ERROR:
			nextState.isConfirming = false;
			nextState.isDeploying = true;
			break;
		case ActionType.DEPLOY_SUCCESS:
			nextState.isConfirming = false;
			nextState.isDeploying = false;
			nextState.data = action.data;
			break;
		case KVEditorActionType.SET_DATA:
			nextState.data = action.data;
			break;
		case KVEditorActionType.SUBMIT_DATA:
			nextState.data = action.data;
			nextState.isConfirming = true;
			break;
		case ActionType.CONFIRM_CANCEL:
			nextState.isConfirming = false;
			break;
		default:
			nextState.data = dataReducer(prevState.data, action);
	}
	return nextState;
}

function MetadataEditor(props: Props) {
	const { appName } = props;
	const { app, loading: isLoading, error: appError } = useApp(appName);
	const [{ dataInitialized, data, isConfirming, isDeploying }, dispatch] = React.useReducer(
		reducer,
		initialState(props)
	);
	const client = useClient();
	const withCancel = useWithCancel();
	const handleError = useErrorHandler();

	React.useEffect(() => {
		if (!appError) return;
		handleError(appError);
	}, [appError, handleError]);

	const [enableNavProtection, disableNavProtection] = useNavProtection();
	React.useEffect(() => {
		if (data && data.hasChanges) {
			enableNavProtection();
		} else {
			disableNavProtection();
		}
	}, [data, disableNavProtection, enableNavProtection]);

	React.useEffect(
		() => {
			if (!app) return;

			// handle setting initial data
			if (!dataInitialized) {
				dispatch({ type: ActionType.INIT_DATA, data: buildData(app.getLabelsMap().toArray()) });
				return;
			}

			// handle app labels being updated elsewhere
			dispatch({ type: KVEditorActionType.SET_DATA, data: rebaseData(data, app.getLabelsMap().toArray()) });
		},
		[app] // eslint-disable-line react-hooks/exhaustive-deps
	);

	const suggestions = React.useMemo(() => {
		return [
			{
				key: 'github.url',
				validateValue: (value: string) => {
					if (value.match(/^https:\/\/github\.com\/[^/]+\/[^/]+$/)) {
						return null;
					}
					return 'invalid github repo URL';
				},
				valueTemplate: {
					value: 'https://github.com/ORG/REPO',
					selectionStart: 19,
					selectionEnd: 27,
					direction: 'forward'
				}
			} as Suggestion
		];
	}, []);

	const handleConfirmSubmit = React.useCallback(
		(event: React.SyntheticEvent) => {
			event.preventDefault();
			const app = new App();
			app.setName(appName);
			protoMapReplace(app.getLabelsMap(), new jspb.Map(getEntries(data as Data)));
			dispatch({ type: ActionType.DEPLOY });
			const cancel = client.updateApp(app, (app: App, error: Error | null) => {
				if (error) {
					dispatch({ type: ActionType.DEPLOY_ERROR, error });
					handleError(error);
					return;
				}
				dispatch({ type: ActionType.DEPLOY_SUCCESS, data: buildData(app.getLabelsMap().toArray()) });
			});
			withCancel.set(`updateApp(${app.getName()}`, cancel);
		},
		[appName, withCancel, client, data, handleError]
	);

	const handleCancelBtnClick = React.useCallback((event?: React.SyntheticEvent) => {
		if (event) {
			event.preventDefault();
		}
		dispatch({ type: ActionType.CONFIRM_CANCEL });
	}, []);

	function renderDeployMetadata() {
		if (!app || !data) return;
		return (
			<Box tag="form" fill direction="column" onSubmit={handleConfirmSubmit}>
				<Box flex="grow">
					<h3>Review Changes</h3>
					<KeyValueDiff prev={app.getLabelsMap()} next={new jspb.Map(getEntries(data))} />
				</Box>
				<Box fill="horizontal" direction="row" align="end" gap="small" justify="between">
					<Button
						type="submit"
						disabled={isDeploying}
						primary
						icon={<CheckmarkIcon />}
						label={isDeploying ? 'Saving...' : 'Save'}
					/>
					<Button type="button" label="Cancel" onClick={handleCancelBtnClick} />
				</Box>
			</Box>
		);
	}

	if (isLoading) {
		return <Loading />;
	}

	return (
		<>
			{isConfirming ? <RightOverlay onClose={handleCancelBtnClick}>{renderDeployMetadata()}</RightOverlay> : null}
			<KeyValueEditor data={data || buildData([])} suggestions={suggestions} dispatch={dispatch} />
		</>
	);
}
export default React.memo(MetadataEditor);

(MetadataEditor as any).whyDidYouRender = true;
