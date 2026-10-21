import { AudioLines } from "lucide-react";
import { toFileUrl } from "@/components/video-editor/projectPersistence";
import type { AxcutAsset } from "@/lib/ai-edition/schema";
export function mediaUrl(path: string): string {
	return /^(https?|blob|data):/.test(path) ? path : toFileUrl(path);
}
export function MediaThumbnail({ asset, onError }: { asset: AxcutAsset; onError?: () => void }) {
	if (!asset?.originalPath) return <AudioLines size={18} />;
	if (asset.kind === "audio")
		return (
			<>
				<AudioLines size={22} />
				<audio src={mediaUrl(asset.originalPath)} preload="metadata" onError={onError} />
			</>
		);
	if (asset.stillImagePath)
		return <img draggable={false} alt="" src={mediaUrl(asset.stillImagePath)} onError={onError} />;
	return (
		<video
			draggable={false}
			aria-hidden
			muted
			preload="metadata"
			src={mediaUrl(asset.originalPath)}
			onError={onError}
			onLoadedMetadata={(event) => {
				event.currentTarget.currentTime = Math.min(0.5, event.currentTarget.duration / 2);
			}}
		/>
	);
}
