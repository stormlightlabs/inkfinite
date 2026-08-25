<script lang="ts">
	interface Props {
		width: number;
		height: number;
		iconDataUrl: string;
		graphicDataUrl: string;
	}

	let { width, height, iconDataUrl, graphicDataUrl }: Props = $props();
</script>

<div
	style="display:flex; position:relative; width:{width}px; height:{height}px; overflow:hidden; background:#171928; color:#d8e6e6; font-family:'IBM Plex Sans';">
	<div
		style="display:flex; position:absolute; inset:0; background:linear-gradient(125deg, #171928 0%, #24243b 58%, #30265a 100%);">
	</div>
	<div
		style="display:flex; position:absolute; inset:0; opacity:0.14; background-image:radial-gradient(#a7b4bc 1.5px, transparent 1.5px); background-size:28px 28px;">
	</div>

	<div
		style="display:flex; position:relative; width:100%; flex-direction:column; padding:48px 58px 46px;">
		<div
			style="display:flex; align-items:center; gap:12px; color:#ffffff; font-family:'Playpen Sans'; font-size:29px; font-weight:600; letter-spacing:-1px;">
			<img src={iconDataUrl} alt="" style="display:flex; width:40px; height:40px;" />
			<span>Inkfinite</span>
		</div>

		<div
			style="display:flex; flex:1; align-items:center; justify-content:space-between; gap:48px;">
			<div style="display:flex; width:580px; flex-direction:column;">
				<div
					style="display:flex; color:#8de2bc; font-size:18px; font-weight:700; letter-spacing:2.1px;">
					LOCAL-FIRST WHITEBOARD
				</div>
				<div
					style="display:flex; margin-top:12px; flex-direction:column; color:#ffffff; font-family:'Google Sans'; font-size:70px; font-weight:700; letter-spacing:-3px; line-height:0.98;">
					<div style="display:flex;">Draw it.</div>
					<div style="display:flex;">Script it.</div>
				</div>
				<div
					style="display:flex; max-width:560px; margin-top:22px; color:#c4ced4; font-size:25px; line-height:1.32;">
					One open canvas for people, tools, and agents.
				</div>
			</div>

			<div
				style="display:flex; width:430px; height:330px; flex-direction:column; overflow:hidden; border:2px solid #646675; border-radius:10px 16px 12px 14px; background:#252738; box-shadow:12px 14px 0 #10131f;">
				<div
					style="display:flex; height:42px; flex-shrink:0; align-items:center; gap:8px; padding:0 14px; border-bottom:1px solid #646675; background:#353746;">
					<div
						style="display:flex; width:10px; height:10px; border-radius:5px; background:#cc5860;">
					</div>
					<div
						style="display:flex; width:10px; height:10px; border-radius:5px; background:#d4a666;">
					</div>
					<div
						style="display:flex; width:10px; height:10px; border-radius:5px; background:#2dcc82;">
					</div>
					<div style="display:flex; margin-left:auto; color:#a7b4bc; font-size:14px;">
						workflow.inkfinite
					</div>
				</div>
				<div style="display:flex; position:relative; flex:1; background:#171928;">
					<div
						style="display:flex; width:45px; flex-shrink:0; flex-direction:column; align-items:center; gap:14px; padding-top:16px; border-right:1px solid #646675; background:#252738;">
						<div
							style="display:flex; width:24px; height:24px; align-items:center; justify-content:center; border-radius:5px; background:#2dcc82; color:#101b18; font-size:16px;">
							↖
						</div>
						<div
							style="display:flex; width:17px; height:17px; border:2px solid #a7b4bc; border-radius:3px;">
						</div>
						<div
							style="display:flex; width:17px; height:17px; border:2px solid #a7b4bc; border-radius:9px;">
						</div>
						<div style="display:flex; color:#a7b4bc; font-size:20px; line-height:1;">
							—
						</div>
						<div
							style="display:flex; color:#a7b4bc; font-size:19px; font-weight:700; line-height:1;">
							T
						</div>
					</div>
					<img
						src={graphicDataUrl}
						alt=""
						style="display:flex; width:385px; height:286px; object-fit:cover;" />
				</div>
			</div>
		</div>

		<div
			style="display:flex; align-items:center; justify-content:space-between; color:#a7b4bc; font-size:18px; line-height:1;">
			<div style="display:flex; align-items:center; gap:10px;">
				<div
					style="display:flex; width:8px; height:8px; border-radius:4px; background:#2dcc82;">
				</div>
				<span>github.com/stormlightlabs/inkfinite</span>
			</div>
			<div style="display:flex; align-items:center; gap:10px;">
				<div
					style="display:flex; width:8px; height:8px; border-radius:4px; background:#8a69f7;">
				</div>
				<span>ink.stormlightlabs.org</span>
			</div>
		</div>
	</div>
</div>
