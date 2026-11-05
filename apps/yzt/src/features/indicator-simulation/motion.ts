/**
 * 是否减少动画。这个页面是演示用的，不跟随系统的"减少动画"设置，总是播放全部动效（2026-10-29 用户确认）；
 * 各处减少动画的写法都保留：脚本里读这里，样式里写在页面根元素的 STILL_CLASS 下，要恢复跟随系统时只改这里
 */
export const reducedMotion = (): boolean => false;

/** 减少动画时页面根元素加的类，样式里的减少动画规则写在它下面 */
export const STILL_CLASS = 'simulation-still';
