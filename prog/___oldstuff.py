def plot_bars(x,y,z, thickness, color, alpha=1):
    d = np.ones(len(x))*thickness
    plot('bar3d', x, y, d*0, d, d, z, color=color, alpha=alpha)
    
def plot_barmap(df, offsets=[0,0], theta=0, thickness=4, alpha=1):
    """ makes a bar plot of the average results in each plot
    What about side, then. Later. See the .org-file"""
    import matplotlib.pyplot as plt
    g = df.groupby('plot_nr')
    average_slope = g.N2O.mean()  #average_something(resdict, ['slopes', 'N2O'])
    average_x = g.x.mean()#average_something(resdict,['chamber_pos', 'x']) 
    average_y = g.y.mean()#average_something(resdict,['chamber_pos', 'y']) 
    treatment = g.treatment.first()
    keys = [x for x in treatment.index if x >=0]
    # keys = [key for key in average_slope if average_slope[key] is not None]
    # keys.sort()
    x = np.array([average_x[key] for key in keys])-offsets[0]
    y = np.array([average_y[key] for key in keys])-offsets[1]
    x = np.cos(theta)*x - np.sin(theta)*y
    y = np.sin(theta)*x + np.cos(theta)*y
    z = [average_slope[key] for key in keys]
    colors = ['b']*len(x)
    colordict = {'norite':'r', 'olivine': 'g', 'larvikite': 'k',
                 'marble': 'w', 'dolomite': 'y', 'control':'b'}
    for material, color  in colordict.iteritems():
        for i in getattr(material_plotnumbers, material):
            if i in keys:
                colors[keys.index(i)] = color
    plot_bars(x, y, z, thickness, color=colors, alpha=alpha)
    # make the legend
    matkeys = colordict.keys()
    proxies = [plt.Rectangle((0,0), 1, 1, fc= colordict[material]) for material in matkeys]
    names = [k[0] for k in matkeys]
    plot('legend', proxies, names)            
    return x, y, z, keys, colors, proxies, names


