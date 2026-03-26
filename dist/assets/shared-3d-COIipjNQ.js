import{E as F,S as I,C as w,M as S,a as z,T as W,P as L,V as $}from"./vendor-babylon-BTGOKxYZ.js";const c=64,m=32,u=2,x=c*u/2,D=m*u/2,P=c-1;F.ShadersStore.wireVertexShader=`
  precision highp float;
  attribute vec3 position;
  attribute vec2 uv;
  attribute vec4 world0;
  attribute vec4 world1;
  attribute vec4 world2;
  attribute vec4 world3;
  uniform mat4 viewProjection;
  varying vec2 vUV;
  void main(void) {
    mat4 world = mat4(world0, world1, world2, world3);
    gl_Position = viewProjection * world * vec4(position, 1.0);
    vUV = uv;
  }
`;F.ShadersStore.wireFragmentShader=`
  precision highp float;
  varying vec2 vUV;
  uniform vec3 wireColor;
  uniform float edgeWidth;
  uniform vec3 fogColor;
  uniform float fogDensity;
  void main(void) {
    float minEdge = min(min(vUV.x, 1.0 - vUV.x), min(vUV.y, 1.0 - vUV.y));
    float depth = gl_FragCoord.z / gl_FragCoord.w;
    float f = fogDensity * depth;
    float fogFactor = clamp(exp(-f * f), 0.0, 1.0);
    if (minEdge > edgeWidth) {
      gl_FragColor = vec4(fogColor, 1.0);
    } else {
      gl_FragColor = vec4(mix(fogColor, wireColor, fogFactor), 1.0);
    }
  }
`;class T{constructor(t,{skipCeiling:e=!1}={}){this.scene=t,this.skipCeiling=e,this.worldGrid=null,this.voxelRoots=[]}build(t){this.worldGrid=t,this.voxelRoots.forEach(s=>{s.material?.dispose(),s.dispose()}),this.voxelRoots=[];const e=new I("wireMat",this.scene,{vertex:"wire",fragment:"wire"},{attributes:["position","uv","world0","world1","world2","world3"],uniforms:["viewProjection","wireColor","edgeWidth","fogColor","fogDensity"]});e.setColor3("wireColor",new w(.1,.85,.7)),e.setFloat("edgeWidth",.055),e.setColor3("fogColor",new w(0,0,0)),e.setFloat("fogDensity",this.scene.fogDensity);const o=S.CreateBox("wireRoot",{size:1},this.scene);o.material=e,o.isVisible=!1,o.isPickable=!1,this.voxelRoots=[o];const y=[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]],r=c,n=c*m,l=new Uint8Array(c*m*c);for(let s=0;s<c;s++)for(let i=0;i<m;i++)for(let a=0;a<c;a++)if(this.isSolid(a,i,s)&&!(this.skipCeiling&&i===m-1)){for(const[v,b,C]of y)if(!this.isSolid(a+v,i+b,s+C)){l[a+i*r+s*n]=1;break}}const d=new Uint8Array(c*m*c),g=c*u,M=[];for(let s=-1;s<=1;s++)for(let i=-1;i<=1;i++)M.push([i*g,s*g]);let V=0,E=0;for(let s=0;s<c;s++)for(let i=0;i<m;i++)for(let a=0;a<c;a++){if(!l[a+i*r+s*n]||d[a+i*r+s*n])continue;let v=1;for(;a+v<c&&l[a+v+i*r+s*n]&&!d[a+v+i*r+s*n];)v++;let b=1;e:for(;s+b<c;){for(let h=0;h<v;h++){const f=a+h+i*r+(s+b)*n;if(!l[f]||d[f])break e}b++}let C=1;e:for(;i+C<m;){for(let h=0;h<b;h++)for(let f=0;f<v;f++){const p=a+f+(i+C)*r+(s+h)*n;if(!l[p]||d[p])break e}C++}for(let h=0;h<C;h++)for(let f=0;f<b;f++)for(let p=0;p<v;p++)d[a+p+(i+h)*r+(s+f)*n]=1;const U=(a+v*.5)*u-x,k=(i+C*.5)*u-D,G=(s+b*.5)*u-x;for(const[h,f]of M){const p=o.createInstance(`v${V++}`);p.position.set(U+h,k,G+f),p.scaling.set(v*u,C*u,b*u),p.isPickable=!1}E++}console.log(`[Voxels] ${E} merged boxes → ${V} instances across 9 tiles`)}isSolid(t,e,o){return this.worldGrid?e<0||e>=m?!0:this.worldGrid[(t&P)+e*c+(o&P)*c*m]===1:!1}bulletHitsWorld(t){return this.worldGrid?this.isSolid(Math.floor((t.x+x)/u),Math.floor((t.y+D)/u),Math.floor((t.z+x)/u)):!1}}const j=18,A=30,_={blue:{d:[.2,.4,.95],e:[.05,.1,.38],g:[.3,.5,1],css:"#4a7aff"},red:{d:[.95,.2,.2],e:[.38,.05,.05],g:[1,.3,.3],css:"#ff4040"}};class H{constructor(t,{labelsEl:e=null,myId:o=null}={}){this.scene=t,this.labelsEl=e,this.myId=o,this.vehicles=new Map,this.bulletMat=new z("bulletMat",t),this.bulletMat.diffuseColor=new w(1,.08,.08),this.bulletMat.emissiveColor=new w(1,0,0),this.bulletMat.specularColor=new w(1,.4,.4)}getVehicle(t){return this.vehicles.get(t)}syncList(t){for(const{id:e,team:o}of t)this.vehicles.has(e)||this.vehicles.set(e,this.createVehicle(e,o));for(const e of[...this.vehicles.keys()])t.find(o=>o.id===e)||this.removeVehicle(e)}createVehicle(t,e){const o=_[e]??_.blue,y={x:0,y:0,z:0,yaw:0},r=new W(`pivot-${t}`,this.scene),n=S.CreateCylinder(`pyramid-${t}`,{diameterTop:0,diameterBottom:1,height:2.2,tessellation:4},this.scene);n.parent=r,n.rotation.x=Math.PI/2,t===this.myId&&(n.isVisible=!1);const l=new z(`mat-${t}`,this.scene);l.diffuseColor=new w(...o.d),l.emissiveColor=new w(...o.e),l.specularColor=new w(.7,.75,1),l.specularPower=64,n.material=l;const d=new L(`glow-${t}`,$.Zero(),this.scene);d.diffuse=new w(...o.g),d.specular=new w(...o.g),d.intensity=3,d.range=10;let g=null;return this.labelsEl&&(g=document.createElement("div"),g.className="vehicle-label",g.textContent=String(t).padStart(2,"0"),g.style.color=o.css,g.style.borderColor=o.css,g.style.boxShadow=`0 0 6px ${o.css}55`,this.labelsEl.appendChild(g)),{pivot:r,pyramid:n,mat:l,glow:d,state:y,bullets:[],label:g,team:e}}spawnBullet(t){const{bullets:e,pivot:o,state:y}=t;if(e.length>=A){const d=e.shift();d.light.dispose(),d.mesh.dispose()}const r=S.CreateSphere("bullet",{diameter:.28,segments:5},this.scene);r.material=this.bulletMat,r.isPickable=!1;const n=1.1;r.position.set(o.position.x+Math.sin(y.yaw)*n,o.position.y,o.position.z+Math.cos(y.yaw)*n);const l=new L("bulletLight",r.position.clone(),this.scene);l.diffuse=new w(1,.25,.05),l.specular=new w(1,.25,.05),l.intensity=1.8,l.range=8,e.push({mesh:r,vx:Math.sin(y.yaw),vz:Math.cos(y.yaw),light:l})}removeVehicle(t){const e=this.vehicles.get(t);e&&(e.pyramid.dispose(),e.pivot.dispose(),e.glow.dispose(),e.mat.dispose(),e.bullets.forEach(o=>{o.light.dispose(),o.mesh.dispose()}),e.label&&e.label.remove(),this.vehicles.delete(t))}}export{j as B,u as C,c as G,x as H,_ as T,H as V,T as W,m as a,P as b,D as c};
