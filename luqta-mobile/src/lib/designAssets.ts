// Bitmaps cut from the Amer AI Store | لُقطة reference designs (tools/extract_assets.py)
// plus the original bundled product photos. Keys are stable ids used by screens & data.
export const designAssets = {
  logoMark: require("../../assets/design/logo-mark.png"),
  catFood: require("../../assets/design/cat-food.png"),
  catElectronics: require("../../assets/design/cat-electronics.png"),
  catFashion: require("../../assets/design/cat-fashion.png"),
  catHome: require("../../assets/design/cat-home.png"),
  exGrocery: require("../../assets/design/ex-grocery.png"),
  exElectronics: require("../../assets/design/ex-electronics.png"),
  exFashion: require("../../assets/design/ex-fashion.png"),
  exHome: require("../../assets/design/ex-home.png"),
  exBeauty: require("../../assets/design/ex-beauty.png"),
  exSports: require("../../assets/design/ex-sports.png"),
  camera3d: require("../../assets/design/camera-3d.png"),
};

// 2D poster frames of the companion, used only when WebGL is unavailable or the
// user turns 3D off. The live companion is the rigged 3D model (web-engines/avatar.js).
export const posePosters = {
  walk: require("../../assets/design/pose-walk.png"),
  cart: require("../../assets/design/pose-cart.png"),
  thumbs: require("../../assets/design/pose-thumbs.png"),
  crossed: require("../../assets/design/pose-crossed.png"),
  idle: require("../../assets/design/pose-stand.png"),
  point: require("../../assets/design/pose-point.png"),
  think: require("../../assets/design/pose-think.png"),
  run: require("../../assets/design/pose-run.png"),
  sit: require("../../assets/design/pose-sit.png"),
  sleep: require("../../assets/design/pose-sleep.png"),
  listen: require("../../assets/design/pose-listen.png"),
  jump: require("../../assets/design/pose-jump.png"),
} as const;

export const productImages: Record<string, ReturnType<typeof require>> = {
  rice: require("../../assets/design/p-rice.png"),
  milk: require("../../assets/design/p-milk.png"),
  banana: require("../../assets/design/p-banana.png"),
  headphones: require("../../assets/design/p-headphones.png"),
  "headphones-2": require("../../assets/design/p-headphones-2.png"),
  "headphones-3": require("../../assets/design/p-headphones-3.png"),
  chair: require("../../assets/design/p-chair.png"),
  speaker: require("../../assets/products/speaker.jpg"),
  keyboard: require("../../assets/products/keyboard.jpg"),
  lamp: require("../../assets/products/lamp.jpg"),
  mug: require("../../assets/products/mug.jpg"),
  sneakers: require("../../assets/products/sneakers.jpg"),
  bag: require("../../assets/products/bag.jpg"),
  watch: require("../../assets/products/watch.jpg"),
  serum: require("../../assets/products/serum.jpg"),
  fragrance: require("../../assets/products/fragrance.jpg"),
  diffuser: require("../../assets/products/diffuser.jpg"),
};

// Cut-outs on a transparent background are shown whole (contain), not cropped like photos.
export const cutoutImages = new Set(["rice", "milk", "banana", "headphones", "headphones-2", "headphones-3", "chair"]);

// Extra views of a product from the mockups, shown after its own photos in the product gallery.
// (p-headphones-4.png is the mockup's video thumbnail, with a play icon drawn on it, so it is not used.)
export const productGalleries: Record<string, string[]> = { headphones: ["headphones-2", "headphones-3"] };

// A gallery entry that points at a bundled image instead of a URL, e.g. "asset:headphones-2".
export const ASSET_URI = "asset:";

// The four departments on the mockups' home screen, in their order, with their illustrations.
export const FEATURED_CATEGORIES = ["fresh", "electronics", "fashion", "home"];
export const categoryArt: Record<string, ReturnType<typeof require>> = {
  fresh: designAssets.catFood,
  electronics: designAssets.catElectronics,
  fashion: designAssets.catFashion,
  home: designAssets.catHome,
};
