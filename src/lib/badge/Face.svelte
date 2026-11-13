<script lang="ts">
  // 이름표 한 면. 크기와 자리는 core 의 badgeLayout 이 정한 mm 값을 그대로 쓴다. 인쇄물이므로 화면 테마와 상관없이 흰 바탕.
  import { INFO_LINE, NAME_LINE, type Band, type BadgeLayout } from './core';

  let {
    w,
    h,
    l,
    event = '',
    band = 'top',
    accent = '#9c5a2b',
    onAccent = '#ffffff',
    align = 'center',
    logo = '',
    no = '',
    table = '',
    qr = '',
    border = false,
  }: {
    w: number;
    h: number;
    l: BadgeLayout;
    event?: string;
    band?: Band;
    accent?: string;
    onAccent?: string;
    align?: 'left' | 'center' | 'right';
    logo?: string;
    no?: string;
    table?: string;
    /** QR 의 SVG 글 */
    qr?: string;
    border?: boolean;
  } = $props();

  const flex = $derived(align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center');
</script>

<div class="face" class:border style:width="{w}mm" style:height="{h}mm" style:--accent={accent} style:--on={onAccent}>
  {#if l.sideW}<i class="side" style:width="{l.sideW}mm"></i>{/if}
  {#if l.headH}
    <div class="head" class:fill={band === 'top'} style:left="{band === 'top' ? 0 : l.sideW}mm" style:height="{l.headH}mm" style:padding="0 {l.pad}mm 0 {l.pad + (band === 'top' ? l.sideW : 0)}mm" style:gap="{l.pad * 0.5}mm">
      {#if event}<span class="event" style:font-size="{l.eventSize}mm" style:text-align={align}>{event}</span>{/if}
      {#if logo}<img src={logo} alt="" style:width="{l.logoW}mm" style:height="{l.logoH}mm" style:margin-left={event || align !== 'left' ? 'auto' : '0'} style:margin-right={!event && align === 'center' ? 'auto' : '0'} />{/if}
    </div>
  {/if}
  <div class="text" style:left="{l.text.x}mm" style:top="{l.text.y}mm" style:width="{l.text.w}mm" style:height="{l.text.h}mm" style:align-items={flex}>
    {#each l.name.lines as line, i (i)}
      <div class="name" style:font-size="{l.name.size}mm" style:line-height={NAME_LINE} style:letter-spacing="{l.name.spacing}em" style:margin-right="{-l.name.spacing}em">{line}</div>
    {/each}
    {#each l.info.lines as line, i (i)}
      <div class="info" style:font-size="{l.info.size}mm" style:line-height={INFO_LINE} style:margin-top="{i ? 0 : l.gap}mm">{line}</div>
    {/each}
  </div>
  {#if qr && l.qr}
    <div class="qr" style:width="{l.qr}mm" style:height="{l.qr}mm" style:right="{l.pad}mm" style:top="{l.text.y + (l.text.h - l.qr) / 2}mm">{@html qr}</div>
  {/if}
  {#if l.footH}
    <div class="foot" style:left="{l.text.x}mm" style:right="{l.pad}mm" style:bottom="{l.pad * 0.45}mm" style:height="{l.footH}mm" style:font-size="{l.footSize}mm">
      <span class="no">{no}</span>
      {#if table}<span class="table">{table}</span>{/if}
    </div>
  {/if}
</div>

<style>
  .face {
    position: relative;
    overflow: hidden;
    background: #fff;
    color: #111;
    text-align: left;
    font-family: var(--font);
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .face.border {
    box-shadow: inset 0 0 0 0.2mm #9a9a9a;
  }
  .side {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    background: var(--accent);
  }
  .head {
    position: absolute;
    top: 0;
    right: 0;
    display: flex;
    align-items: center;
    color: color-mix(in srgb, var(--accent) 70%, #111);
  }
  .head.fill {
    background: var(--accent);
    color: var(--on);
  }
  .event {
    flex: 1;
    min-width: 0;
    font-weight: 700;
    line-height: 1.2;
    letter-spacing: -0.01em;
    white-space: nowrap;
  }
  .head img {
    flex: none;
    object-fit: contain;
  }
  .head.fill img {
    box-sizing: content-box;
    padding: 0.5mm 1mm;
    margin-top: -0.5mm;
    margin-bottom: -0.5mm;
    border-radius: 1mm;
    background: #fff;
  }
  .text {
    position: absolute;
    display: flex;
    flex-direction: column;
    justify-content: center;
  }
  .name {
    font-weight: 800;
    white-space: nowrap;
  }
  .info {
    font-weight: 500;
    color: #3d4046;
    white-space: nowrap;
  }
  .qr {
    position: absolute;
  }
  .qr :global(svg) {
    display: block;
    width: 100%;
    height: 100%;
  }
  .foot {
    position: absolute;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 2mm;
    line-height: 1;
    font-weight: 650;
    color: #6a6e76;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .table {
    margin-left: auto;
    padding: 0.18em 0.6em;
    border-radius: 99px;
    color: color-mix(in srgb, var(--accent) 75%, #111);
    background: color-mix(in srgb, var(--accent) 14%, #fff);
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
