import * as React from 'react';

import WindowedListState from './WindowedListState';

function findScrollParent(node: HTMLElement | null): HTMLElement | Window {
	while (node) {
		switch (window.getComputedStyle(node).overflowY) {
			case 'auto':
				return node;
			case 'scroll':
				return node;
			default:
				node = node.parentElement;
		}
	}
	return window;
}

export interface ChildrenProps {
	onItemRender: (index: number, node: HTMLElement | null) => void;
	shouldItemRender: (index: number) => boolean;
	getItemDimensions: (index: number) => ItemDimensions | null;
}

export interface Props {
	state: WindowedListState;
	thresholdTop: number; // number of pixels to keep rendered beyond the top of viewport
	children: (props: ChildrenProps) => React.ReactNode;
}

interface ItemDimensions {
	top: number;
	height: number;
}

export default function WindowedList({ state, thresholdTop, children }: Props) {
	const itemDimensions = React.useMemo(() => new Map<number, ItemDimensions | null>(), []);
	const itemResizeObservers = React.useMemo(() => new Map<number, ResizeObserver>(), []);
	const scrollParentRef = React.useMemo<{ current: HTMLElement | Window | null }>(() => ({ current: null }), []);

	const willUnmountFns = React.useMemo<Array<() => void>>(() => [], []);
	React.useEffect(
		() => {
			return () => {
				willUnmountFns.forEach((fn) => fn());
			};
		},
		[willUnmountFns]
	);

	const calcItemDimensions = React.useCallback((node: HTMLElement): ItemDimensions | null => {
		const rect = node.getClientRects()[0];
		if (!rect) return null;
		const style = window.getComputedStyle(node);
		const margin =
			parseFloat(style.getPropertyValue('margin-top')) + parseFloat(style.getPropertyValue('margin-bottom'));
		const dimensions = { top: rect.top, height: rect.height + margin };
		return dimensions;
	}, []);

	const getScrollTop = React.useCallback(
		() => {
			if (scrollParentRef.current === null) {
				return 0;
			}
			let scrollTop = 0;
			if (scrollParentRef.current === window) {
				scrollTop = window.scrollY;
			} else {
				scrollTop = (scrollParentRef.current as HTMLElement).scrollTop;
			}
			return scrollTop;
		},
		[scrollParentRef]
	);

	const handleScroll = React.useCallback(
		() => {
			const scrollTop = Math.max(0, getScrollTop() - thresholdTop);
			state.updateScrollPosition(scrollTop);
		},
		[getScrollTop, state, thresholdTop]
	);

	const onItemRender = React.useCallback(
		(index: number, node: HTMLElement | null) => {
			if (!node) {
				return;
			}

			// keep track of any changes in the node dimensions
			if (!itemResizeObservers.get(index)) {
				// TODO(jvatic): Figure out and fix why this causes scrolling to freeze
				// const resizeObserver = new window.ResizeObserver((entries, observer) => {
				// 	for (let entry of entries) {
				// 		if (entry.target !== node) continue;
				// 		const prevDimensions = itemDimensions.get(index);
				// 		const dimensions = calcItemDimensions(node);
				// 		if (prevDimensions && dimensions && prevDimensions.height === dimensions.height) {
				// 			// no change
				// 			continue;
				// 		}
				// 		itemDimensions.set(index, dimensions);
				// 		if (dimensions) {
				// 			state.updateHeightAtIndex(index, dimensions.height);
				// 		}
				// 	}
				// });
				// resizeObserver.observe(node);
				// willUnmountFns.push(() => resizeObserver.disconnect());
			}

			// calculate item dimensions
			const dimensions = calcItemDimensions(node);
			itemDimensions.set(index, dimensions);
			if (dimensions) {
				state.updateHeightAtIndex(index, dimensions.height);
			}

			if (scrollParentRef.current === null) {
				const scrollParentNode = findScrollParent(node.parentElement);
				scrollParentRef.current = scrollParentNode;
				scrollParentNode.addEventListener('scroll', handleScroll, false);
				willUnmountFns.push(() => {
					scrollParentNode.removeEventListener('scroll', handleScroll, false);
				});
			}
		},
		[calcItemDimensions, handleScroll, itemDimensions, itemResizeObservers, scrollParentRef, state, willUnmountFns]
	);

	const shouldItemRender = React.useCallback(
		(index: number): boolean => {
			// item should render if it's in the visible index range
			return state.visibleIndexTop <= index && state.visibleIndexTop + state.visibleLength > index;
		},
		[state] // eslint-disable-line react-hooks/exhaustive-deps
	);

	const getItemDimensions = React.useCallback(
		(index: number): ItemDimensions | null => {
			return itemDimensions.get(index) || null;
		},
		[itemDimensions]
	);

	return <>{children({ onItemRender, shouldItemRender, getItemDimensions })}</>;
}

export interface ItemProps extends ChildrenProps {
	index: number;
	children: (ref: React.MutableRefObject<HTMLElement | null>) => React.ReactNode;
}

export const WindowedListItem = ({ children, index, onItemRender, shouldItemRender, getItemDimensions }: ItemProps) => {
	const ref = React.useMemo<{ current: null | HTMLElement }>(() => ({ current: null }), []);
	React.useLayoutEffect(
		() => {
			onItemRender(index, ref.current);
		},
		[getItemDimensions, index, onItemRender, ref]
	);
	return <>{children(ref)}</>;
};
