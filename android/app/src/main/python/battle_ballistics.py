"""Geometric cover paths, separate from visual authorization and damage math.

A configured profile is a GM's explicit coverage/material declaration. It is
not a height simulation. Unconfigured legacy low cover retains only the old
adjacent-target leg-exposure example; it has no guessed material SP. A wall
or closed door has no ballistic SP until configured. Open doors contribute
nothing. Adjacent ray intervals through identical wall cells form one solid
barrier, not one armor layer per visual grid cell; different materials or an
intervening gap form separate layers. This is a disclosed grid convention.

All coordinates/complete barriers are trusted-server data. Do not return the
receipt directly to a player; the adapter filters preview and event geometry.
"""
import copy
from battle_cover_scene import active_prop_protection

ZONES=('head','torso','rightArm','leftArm','rightLeg','leftLeg')


def _interval(ax,ay,bx,by,x,y,w,h):
    """Closed rectangle / segment overlap, including a sealed corner."""
    lo,hi=0.0,1.0
    for origin,delta,minimum,maximum in ((ax,bx-ax,x,x+w),(ay,by-ay,y,y+h)):
        if abs(delta)<1e-12:
            if origin<minimum or origin>maximum:return None
        else:
            left,right=(minimum-origin)/delta,(maximum-origin)/delta
            if left>right:left,right=right,left
            lo,hi=max(lo,left),min(hi,right)
            if lo>hi+1e-12:return None
    return (lo,hi) if hi>1e-9 and lo<1-1e-9 else None


def trace_cover(scene,actor,target):
    ax,ay=actor['x']+.5,actor['y']+.5;bx,by=target['x']+.5,target['y']+.5
    tiles=[];barriers=[]
    for y,row in enumerate(scene['tiles']):
        for x,tile in enumerate(row):
            if (x,y) in ((actor['x'],actor['y']),(target['x'],target['y'])):continue
            if tile['type']!='wall' and not (tile['type']=='door' and not tile['open']):continue
            segment=_interval(ax,ay,bx,by,x,y,1,1)
            if segment is None:continue
            profile=tile.get('protection')
            tiles.append(dict(id='tile:'+str(x)+':'+str(y),kind=tile['type'],x=x,y=y,
                enter=segment[0],exit=segment[1],sp=profile['sp'] if profile else None,
                material=profile['material'] if profile else None,coveredZones=list(ZONES),opaque=True))
    tiles.sort(key=lambda item:(item['enter'],item['exit'],item['id']))
    for layer in tiles:
        previous=barriers[-1] if barriers else None
        # Do not merge a door into its adjacent wall or merge separated walls.
        same=previous and previous['kind']==layer['kind']=='wall' and previous['sp']==layer['sp'] and previous['material']==layer['material']
        if same and layer['enter']<=previous['exit']+1e-9:
            previous['exit']=max(previous['exit'],layer['exit'])
        else:barriers.append(layer)
    for prop in scene['props']:
        segment=_interval(ax,ay,bx,by,prop['x'],prop['y'],prop['w'],prop['h'])
        if segment is None:continue
        profile=active_prop_protection(prop)
        if profile is None:
            adjacent=max(abs(target['x']-max(prop['x'],min(target['x'],prop['x']+prop['w']-1))),abs(target['y']-max(prop['y'],min(target['y'],prop['y']+prop['h']-1))))<=1
            if not prop.get('cover') or not adjacent:continue
            profile=dict(sp=None,material=None,coveredZones=['rightLeg','leftLeg'],blocksVision=False)
        if not profile['coveredZones'] and not profile['blocksVision']:continue
        barriers.append(dict(id='prop:'+prop['id'],kind='prop',propId=prop['id'],x=prop['x'],y=prop['y'],enter=segment[0],exit=segment[1],
            sp=profile['sp'],material=profile['material'],coveredZones=list(profile['coveredZones']),opaque=profile['blocksVision']))
    barriers.sort(key=lambda item:(item['enter'],item['exit'],item['id']))
    protected=set(zone for item in barriers for zone in item['coveredZones'])
    return dict(barriers=barriers,blocked=any(item['opaque'] for item in barriers),
        exposed=[zone for zone in ZONES if zone not in protected],cover=copy.deepcopy(barriers[-1]) if barriers else None)


def protection_layers(trace,location):
    """Only physically intersected, configured layers; ordered target outward."""
    if location not in ZONES:raise ValueError('Unknown hit location')
    layers=[]
    for item in reversed(trace['barriers']):
        if location not in item['coveredZones']:continue
        if item['sp'] is None:raise ValueError('Material SP is not configured')
        layers.append(dict(id=item['id'],sp=item['sp']))
    if len(layers)>16:raise ValueError('More than16 physical layers require GM adjudication')
    return layers
