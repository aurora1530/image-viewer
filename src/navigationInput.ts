type Direction = 'back' | 'forward';
type Source = 'mouse' | 'command';

// A side-button click can arrive both as a DOM mouse event and an OS command.
// Pair only different sources so repeated clicks from the same source survive.
export function createNavigationInput(
	navigate: (direction: Direction) => void,
	now: () => number = () => performance.now()
) {
	let previous: { direction: Direction; source: Source; time: number } | null = null;
	return (direction: Direction, source: Source) => {
		const time = now();
		if (previous && previous.direction === direction && previous.source !== source
			&& time - previous.time < 250) {
			previous = null;
			return;
		}
		previous = { direction, source, time };
		navigate(direction);
	};
}
