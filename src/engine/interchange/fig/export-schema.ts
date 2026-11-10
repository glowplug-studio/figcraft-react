import type {readKiwiSchema} from "./kiwi";

// Wire tags are fixed by the Fig format. Each exported canvas carries this schema.
const declarations:readonly [string,number,string][]=[
  ["MessageType",0,"JOIN_START=0 NODE_CHANGES=1"],
  ["NodePhase",0,"CREATED=0 REMOVED=1"],
  ["NodeType",0,"NONE=0 DOCUMENT=1 CANVAS=2 GROUP=3 FRAME=4 BOOLEAN_OPERATION=5 VECTOR=6 STAR=7 LINE=8 ELLIPSE=9" +
    " RECTANGLE=10 REGULAR_POLYGON=11 ROUNDED_RECTANGLE=12 TEXT=13 SLICE=14 SYMBOL=15 INSTANCE=16" +
    " SECTION=25 VARIABLE=28 VARIABLE_SET=31"],
  ["BlendMode",0,"PASS_THROUGH=0 NORMAL=1 DARKEN=2 MULTIPLY=3 LINEAR_BURN=4 COLOR_BURN=5 LIGHTEN=6 SCREEN=7" +
    " LINEAR_DODGE=8 COLOR_DODGE=9 OVERLAY=10 SOFT_LIGHT=11 HARD_LIGHT=12 DIFFERENCE=13 EXCLUSION=14 HUE=15" +
    " SATURATION=16 COLOR=17 LUMINOSITY=18"],
  ["PaintType",0,"SOLID=0 GRADIENT_LINEAR=1 GRADIENT_RADIAL=2 GRADIENT_ANGULAR=3 GRADIENT_DIAMOND=4 IMAGE=5"],
  ["ImageScaleMode",0,"STRETCH=0 FIT=1 FILL=2 TILE=3"],
  ["WindingRule",0,"NONZERO=0 ODD=1"],
  ["StrokeAlign",0,"CENTER=0 INSIDE=1 OUTSIDE=2"],
  ["StrokeCap",0,"NONE=0 ROUND=1 SQUARE=2 ARROW_LINES=3 ARROW_EQUILATERAL=4 TRIANGLE_FILLED=6 DIAMOND_FILLED=5" +
    " CIRCLE_FILLED=14"],
  ["StrokeJoin",0,"MITER=0 BEVEL=1 ROUND=2"],
  ["ConstraintType",0,"MIN=0 CENTER=1 MAX=2 STRETCH=3 SCALE=4"],
  ["StackMode",0,"NONE=0 HORIZONTAL=1 VERTICAL=2 GRID=3"],
  ["StackAlign",0,"MIN=0 CENTER=1 MAX=2 BASELINE=3"],
  ["StackJustify",0,"MIN=0 CENTER=1 MAX=2 SPACE_EVENLY=3 SPACE_BETWEEN=4 SPACE_AROUND=5 SPACE_EVENLY_CSS=6"],
  ["StackCounterAlign",0,"MIN=0 CENTER=1 MAX=2 STRETCH=3 AUTO=4 BASELINE=5"],
  ["StackSize",0,"FIXED=0 RESIZE_TO_FIT=1"],
  ["StackWrap",0,"NO_WRAP=0 WRAP=1"],
  ["StackCounterAlignContent",0,"AUTO=0 SPACE_BETWEEN=1"],
  ["StackPositioning",0,"AUTO=0 ABSOLUTE=1"],
  ["EffectType",0,"INNER_SHADOW=0 DROP_SHADOW=1 FOREGROUND_BLUR=2 BACKGROUND_BLUR=3 NOISE=7 GRAIN=6 GLASS=8"],
  ["BlurOpType",0,"NORMAL=0 PROGRESSIVE=1"],
  ["NoiseType",0,"MONOTONE=1 DUOTONE=2 MULTITONE=0"],
  ["TextAlignHorizontal",0,"LEFT=0 CENTER=1 RIGHT=2 JUSTIFIED=3"],
  ["TextAlignVertical",0,"TOP=0 CENTER=1 BOTTOM=2"],
  ["TextAutoResize",0,"NONE=0 WIDTH_AND_HEIGHT=1 HEIGHT=2"],
  ["TextTruncation",0,"DISABLED=0 ENDING=1"],
  ["TextCase",0,"ORIGINAL=0 UPPER=1 LOWER=2 TITLE=3 SMALL_CAPS=4"],
  ["TextDecoration",0,"NONE=0 UNDERLINE=1 STRIKETHROUGH=2"],
  ["NumberUnits",0,"RAW=0 PIXELS=1 PERCENT=2"],
  ["LineType",0,"PLAIN=0 ORDERED_LIST=1 UNORDERED_LIST=2"],
  ["SourceDirectionality",0,"AUTO=0 LTR=1 RTL=2"],
  ["DocumentColorProfile",0,"LEGACY=0 SRGB=1 DISPLAY_P3=2"],
  ["EmojiImageSet",0,"APPLE=0 NOTO=1"],
  ["MaskType",0,"ALPHA=0 OUTLINE=1 LUMINANCE=2"],
  ["VariableResolvedDataType",0,"BOOLEAN=0 FLOAT=1 STRING=2 COLOR=4 SYMBOL_ID=6 TEXT_DATA=8"],
  ["VectorMirror",0,"NONE=0 ANGLE=1 ANGLE_AND_LENGTH=2"],
  ["BooleanOperation",0,"UNION=0 INTERSECT=1 SUBTRACT=2 XOR=3"],
  ["LayoutGridType",0,"MIN=0 CENTER=1 STRETCH=2 MAX=3"],
  ["LayoutGridPattern",0,"STRIPES=0 GRID=1"],
  ["Axis",0,"X=0 Y=1"],
  ["ImageType",0,"PNG=0 JPEG=1 SVG=2 PDF=3"],
  ["ExportConstraintType",0,"CONTENT_SCALE=0 CONTENT_WIDTH=1 CONTENT_HEIGHT=2"],
  ["ComponentPropType",0,"BOOL=0 TEXT=1 INSTANCE_SWAP=3 VARIANT=4"],
  ["VariableField",0,"MISSING=0 CORNER_RADIUS=1 PARAGRAPH_SPACING=2 PARAGRAPH_INDENT=3 STROKE_WEIGHT=4 STACK_SPACING=5" +
    " STACK_PADDING_LEFT=6 STACK_PADDING_TOP=7 STACK_PADDING_RIGHT=8 STACK_PADDING_BOTTOM=9 VISIBLE=10" +
    " TEXT_DATA=11 WIDTH=12 HEIGHT=13 RECTANGLE_TOP_LEFT_CORNER_RADIUS=14" +
    " RECTANGLE_TOP_RIGHT_CORNER_RADIUS=15 RECTANGLE_BOTTOM_LEFT_CORNER_RADIUS=16" +
    " RECTANGLE_BOTTOM_RIGHT_CORNER_RADIUS=17 BORDER_TOP_WEIGHT=18 BORDER_BOTTOM_WEIGHT=19" +
    " BORDER_LEFT_WEIGHT=20 BORDER_RIGHT_WEIGHT=21 STACK_COUNTER_SPACING=23 MIN_WIDTH=24 MAX_WIDTH=25" +
    " MIN_HEIGHT=26 MAX_HEIGHT=27 FONT_FAMILY=28 FONT_STYLE=29 OPACITY=31 FONT_SIZE=32 LETTER_SPACING=34" +
    " LINE_HEIGHT=36 OVERRIDDEN_SYMBOL_ID=37"],
  ["VariableDataType",0,"BOOLEAN=0 FLOAT=1 STRING=2 ALIAS=3 COLOR=4 SYMBOL_ID=7 TEXT_DATA=9 PROP_REF=13"],
  ["VariableScope",0,"ALL_SCOPES=0 TEXT_CONTENT=1 CORNER_RADIUS=2 WIDTH_HEIGHT=3 GAP=4 ALL_FILLS=5 FRAME_FILL=6" +
    " SHAPE_FILL=7 TEXT_FILL=8 STROKE=9 STROKE_FLOAT=10 EFFECT_FLOAT=11 EFFECT_COLOR=12 OPACITY=13" +
    " FONT_STYLE=14 FONT_FAMILY=15 FONT_SIZE=16 LINE_HEIGHT=17 LETTER_SPACING=18 PARAGRAPH_SPACING=19" +
    " PARAGRAPH_INDENT=20"],
  ["StyleType",0,"NONE=0 FILL=1 STROKE=2 TEXT=3 EFFECT=4 EXPORT=5 GRID=6"],
  ["GUID",1,"sessionID:uint=1 localID:uint=2"],
  ["Color",1,"r:float=1 g:float=2 b:float=3 a:float=4"],
  ["Vector",1,"x:float=1 y:float=2"],
  ["Matrix",1,"m00:float=1 m01:float=2 m02:float=3 m10:float=4 m11:float=5 m12:float=6"],
  ["ColorStop",1,"color:Color=1 position:float=2"],
  ["ParentIndex",1,"guid:GUID=1 position:string=2"],
  ["Image",2,"hash:byte[]=1 name:string=2"],
  ["VariableWidthPoint",2,"position:float=1 ascent:float=2 descent:float=3"],
  ["PluginData",2,"pluginID:string=1 value:string=2 key:string=3"],
  ["StyleId",2,"guid:GUID=1"],
  ["VariableID",2,"guid:GUID=1"],
  ["VariableSetID",2,"guid:GUID=1"],
  ["ColorStopVar",2,"color:Color=1 colorVar:VariableData=2 position:float=3"],
  ["Paint",2,"type:PaintType=1 color:Color=2 opacity:float=3 visible:bool=4 blendMode:BlendMode=5" +
    " stops:ColorStop[]=6 transform:Matrix=7 image:Image=8 imageScaleMode:ImageScaleMode=10" +
    " rotation:float=11 scale:float=12 colorVar:VariableData=21 stopsVar:ColorStopVar[]=23"],
  ["Effect",2,"type:EffectType=1 color:Color=2 offset:Vector=3 radius:float=4 visible:bool=5 blendMode:BlendMode=6" +
    " spread:float=7 showShadowBehindNode:bool=8 blurOpType:BlurOpType=19 startRadius:float=21" +
    " startOffset:Vector=20 endOffset:Vector=28 noiseType:NoiseType=26 noiseSize:Vector=22 density:float=25" +
    " opacity:float=27 secondaryColor:Color=24 clipToShape:bool=23 radiusVar:VariableData=9" +
    " colorVar:VariableData=10 spreadVar:VariableData=11 xVar:VariableData=12 yVar:VariableData=13" +
    " startRadiusVar:VariableData=45"],
  ["FontName",1,"family:string=1 style:string=2 postscript:string=3"],
  ["Number",1,"value:float=1 units:NumberUnits=2"],
  ["Hyperlink",2,"url:string=1"],
  ["TextLineData",2,"lineType:LineType=1 styleId:int=10 indentationLevel:int=2 sourceDirectionality:SourceDirectionality=9" +
    " listStartOffset:int=7 isFirstLineOfList:bool=8"],
  ["TextData",2,"characters:string=1 characterStyleIDs:uint[]=2 styleOverrideTable:NodeChange[]=3" +
    " lines:TextLineData[]=12"],
  ["Path",2,"windingRule:WindingRule=1 commandsBlob:uint=2 styleID:uint=3"],
  ["VectorData",2,"vectorNetworkBlob:uint=1 normalizedSize:Vector=2 styleOverrideTable:NodeChange[]=3"],
  ["ArcData",2,"startingAngle:float=1 endingAngle:float=2 innerRadius:float=3"],
  ["OptionalVector",2,"value:Vector=1"],
  ["LayoutGrid",2,"type:LayoutGridType=1 axis:Axis=2 visible:bool=3 numSections:int=4 offset:float=5 sectionSize:float=6" +
    " gutterSize:float=7 color:Color=8 pattern:LayoutGridPattern=9 numSectionsVar:VariableData=10" +
    " offsetVar:VariableData=11 sectionSizeVar:VariableData=12 gutterSizeVar:VariableData=13"],
  ["ExportConstraint",1,"type:ExportConstraintType=1 value:float=2"],
  ["ExportSettings",2,"suffix:string=1 imageType:ImageType=2 constraint:ExportConstraint=3"],
  ["GUIDPath",2,"guids:GUID[]=1"],
  ["SymbolData",2,"symbolID:GUID=1 symbolOverrides:NodeChange[]=2 uniformScaleFactor:float=3"],
  ["ComponentPropValue",2,"boolValue:bool=1 textValue:TextData=2 guidValue:GUID=3"],
  ["ComponentPropPreferredValues",2,"stringValues:string[]=1"],
  ["ComponentPropDef",2,"id:GUID=1 name:string=2 initialValue:ComponentPropValue=3 sortPosition:string=4" +
    " parentPropDefId:GUID=5 type:ComponentPropType=6 preferredValues:ComponentPropPreferredValues=8" +
    " varValue:VariableData=9"],
  ["ComponentPropAssignment",2,"defID:GUID=1 value:ComponentPropValue=2 varValue:VariableData=3"],
  ["ComponentPropNodeField",0,"VISIBLE=0 TEXT_DATA=1 OVERRIDDEN_SYMBOL_ID=2"],
  ["ComponentPropRef",2,"defID:GUID=2 componentPropNodeField:ComponentPropNodeField=4"],
  ["VariantPropSpec",2,"propDefId:GUID=1 value:string=2"],
  ["StateGroupPropertyValueOrder",2,"property:string=1 values:string[]=2"],
  ["PropRefValue",2,"defId:GUID=1"],
  ["SymbolId",2,"guid:GUID=1"],
  ["VariableAnyValue",2,"boolValue:bool=1 textValue:string=2 floatValue:float=3 alias:VariableID=4 colorValue:Color=5" +
    " symbolIdValue:SymbolId=8 textDataValue:TextData=10 propRefValue:PropRefValue=13"],
  ["VariableData",2,"value:VariableAnyValue=1 dataType:VariableDataType=2 resolvedDataType:VariableResolvedDataType=3"],
  ["VariableDataMapEntry",2,"nodeField:uint=1 variableData:VariableData=2 variableField:VariableField=3"],
  ["VariableDataMap",2,"entries:VariableDataMapEntry[]=1"],
  ["VariableModeBySetMapEntry",2,"variableSetID:VariableSetID=1 variableModeID:GUID=2"],
  ["VariableModeBySetMap",2,"entries:VariableModeBySetMapEntry[]=1"],
  ["VariableSetMode",2,"id:GUID=1 name:string=2 sortPosition:string=3"],
  ["VariableDataValuesEntry",2,"modeID:GUID=1 variableData:VariableData=2"],
  ["VariableDataValues",2,"entries:VariableDataValuesEntry[]=1"],
  ["GUIDPositionMapEntry",2,"id:GUID=1 position:string=2"],
  ["GUIDPositionMap",2,"entries:GUIDPositionMapEntry[]=1"],
  ["GridTrackSizingType",0,"FLEX=0 FIXED=1 HUG=2 UNKNOWN=3"],
  ["GridTrackSizingFunction",2,"type:GridTrackSizingType=1 value:float=2"],
  ["GridTrackSize",2,"minSizing:GridTrackSizingFunction=1 maxSizing:GridTrackSizingFunction=2"],
  ["GUIDGridTrackSizeMapEntry",2,"id:GUID=1 trackSize:GridTrackSize=2"],
  ["GUIDGridTrackSizeMap",2,"entries:GUIDGridTrackSizeMapEntry[]=1"],
  ["NodeChange",2,"guid:GUID=1 phase:NodePhase=2 parentIndex:ParentIndex=3 type:NodeType=4 name:string=5 visible:bool=6" +
    " locked:bool=7 opacity:float=8 blendMode:BlendMode=9 size:Vector=11 transform:Matrix=12 mask:bool=16" +
    " maskType:MaskType=317 backgroundOpacity:float=19 backgroundEnabled:bool=15 internalOnly:bool=142" +
    " description:string=318 styleType:StyleType=163 sortPosition:string=320 styleIdForFill:StyleId=332" +
    " styleIdForStrokeFill:StyleId=333 styleIdForText:StyleId=334 styleIdForEffect:StyleId=335" +
    " styleIdForGrid:StyleId=336 variableConsumptionMap:VariableDataMap=307" +
    " variableModeBySetMap:VariableModeBySetMap=316 variableSetModes:VariableSetMode[]=312" +
    " variableSetID:VariableSetID=313 variableResolvedType:VariableResolvedDataType=314" +
    " variableDataValues:VariableDataValues=315 variableScopes:VariableScope[]=353" +
    " documentColorProfile:DocumentColorProfile=349 fillPaints:Paint[]=38 strokePaints:Paint[]=39" +
    " strokeWeight:float=26 strokeAlign:StrokeAlign=29 strokeJoin:StrokeJoin=31 strokeCap:StrokeCap=30" +
    " dashPattern:float[]=13 miterLimit:float=25 borderStrokeWeightsIndependent:bool=299" +
    " borderTopWeight:float=295 borderRightWeight:float=298 borderBottomWeight:float=296" +
    " borderLeftWeight:float=297 effects:Effect[]=43 cornerRadius:float=20 cornerSmoothing:float=160" +
    " rectangleCornerRadiiIndependent:bool=149 rectangleTopLeftCornerRadius:float=145" +
    " rectangleTopRightCornerRadius:float=146 rectangleBottomRightCornerRadius:float=148" +
    " rectangleBottomLeftCornerRadius:float=147 horizontalConstraint:ConstraintType=28" +
    " verticalConstraint:ConstraintType=37 frameMaskDisabled:bool=115 resizeToFit:bool=117" +
    " isStateGroup:bool=225 stateGroupPropertyValueOrders:StateGroupPropertyValueOrder[]=238" +
    " sectionContentsHidden:bool=283 backgroundColor:Color=50 stackMode:StackMode=105 stackSpacing:float=107 stackCounterSpacing:float=324" +
    " stackWrap:StackWrap=323 stackCounterAlignContent:StackCounterAlignContent=343" +
    " stackHorizontalPadding:float=209 stackVerticalPadding:float=210 stackPaddingRight:float=233" +
    " stackPaddingBottom:float=234 stackPrimaryAlignItems:StackJustify=230" +
    " stackCounterAlignItems:StackAlign=231 stackPrimarySizing:StackSize=229" +
    " stackCounterSizing:StackSize=221 bordersTakeSpace:bool=294 stackReverseZIndex:bool=271" +
    " gridColumnGap:float=438 gridRowGap:float=437 gridColumns:GUIDPositionMap=436" +
    " gridRows:GUIDPositionMap=435 gridColumnsSizing:GUIDGridTrackSizeMap=474" +
    " gridRowsSizing:GUIDGridTrackSizeMap=475 stackChildPrimaryGrow:float=232" +
    " stackChildAlignSelf:StackCounterAlign=236 stackPositioning:StackPositioning=269" +
    " minSize:OptionalVector=325 maxSize:OptionalVector=326 gridColumnAnchor:GUID=440" +
    " gridRowAnchor:GUID=439 gridColumnSpan:uint=442 gridRowSpan:uint=441 layoutGrids:LayoutGrid[]=47" +
    " exportSettings:ExportSettings[]=45 textData:TextData=42 fontName:FontName=41 fontSize:float=21" +
    " lineHeight:Number=40 letterSpacing:Number=165 textCase:TextCase=34 textDecoration:TextDecoration=35" +
    " textAlignHorizontal:TextAlignHorizontal=32 textAlignVertical:TextAlignVertical=33" +
    " textAutoResize:TextAutoResize=46 textTruncation:TextTruncation=280 maxLines:int=351" +
    " paragraphSpacing:float=23 paragraphIndent:float=22 hyperlink:Hyperlink=223 autoRename:bool=14" +
    " fontVariantCommonLigatures:bool=127 fontVariantContextualLigatures:bool=128 fontVersion:string=202" +
    " textUserLayoutVersion:uint=203 textExplicitLayoutVersion:uint=396 textBidiVersion:uint=279" +
    " textTracking:float=27 textDecorationSkipInk:bool=412 emojiImageSet:EmojiImageSet=391 styleID:uint=49" +
    " fillGeometry:Path[]=51 strokeGeometry:Path[]=52 vectorData:VectorData=48" +
    " handleMirroring:VectorMirror=44 count:uint=10 starInnerScale:float=24 arcData:ArcData=195" +
    " booleanOperation:BooleanOperation=36 symbolDescription:string=144" +
    " variableWidthPoints:VariableWidthPoint[]=447 pluginData:PluginData[]=204 symbolData:SymbolData=113" +
    " derivedSymbolData:NodeChange[]=125 overriddenSymbolID:GUID=143" +
    " componentPropDefs:ComponentPropDef[]=266 componentPropRefs:ComponentPropRef[]=267" +
    " componentPropAssignments:ComponentPropAssignment[]=268 variantPropSpecs:VariantPropSpec[]=483" +
    " parameterConsumptionMap:VariableDataMap=445 guidPath:GUIDPath=111"],
  ["Blob",1,"bytes:byte[]=1"],
  ["Message",2,"type:MessageType=1 sessionID:uint=2 nodeChanges:NodeChange[]=4 blobs:Blob[]=6"],
];

const builtins=["bool","byte","int","uint","float","string","int64","uint64"];
const indices=new Map(declarations.map(([name],i)=>[name,i]));
export const figExportSchema:ReturnType<typeof readKiwiSchema>=declarations.map(([name,kind,description])=>{
  const fields=description.split(" ").map(token=>{
    const [field,tag]=token.split("="),[name,wireType]=field.split(":");
    const array=wireType?.endsWith("[]") ?? false,base=wireType?.replace(/\[\]$/,"");
    const builtin=builtins.indexOf(base);
    const type=kind===0 ? 0 : builtin>=0 ? -builtin-1 : indices.get(base);
    if (type===undefined) throw new Error("Unknown Fig wire type "+base);
    return {name,id:Number(tag),array,type};
  });
  return {name,kind,fields,byId:new Map(fields.map(f=>[f.id,f]))};
});
