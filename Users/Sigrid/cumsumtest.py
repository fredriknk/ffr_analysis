import pandas as pd
# plt.ioff()
import numpy as np
from time import time

from matplotlib.backend_bases import MouseButton
import matplotlib.pyplot as plt
import numpy as np
import matplotlib.pyplot as plt
from matplotlib.lines import Line2D
from matplotlib.patches import Rectangle
from matplotlib.text import Text
from matplotlib.image import AxesImage
import numpy as np
from numpy.random import rand

def getN2Odata(df,plotno,tot_n2o_sum = []):
    plot = df[df['nr'] == plotno]  # select the data from plot 2

    n2o = plot['N2O_N_mug_m2h'] * 10000 / 1e9
    n2o_avg = n2o.rolling(window=2).mean()
    n2o_avg.iloc[0] = 0.

    timediff = plot["date"].diff() / pd.Timedelta(hours=1)
    timediff.iloc[0] = 0.

    n2o_sum = n2o_avg * timediff

    n2o_int = n2o_sum.cumsum()

    tot_n2o_sum = np.append(tot_n2o_sum, n2o_sum.sum())
    plot.index = plot.date
    n2o_int.index = plot.date
    plot_n2o = plot['N2O_N_mug_m2h']

    return plot_n2o,tot_n2o_sum,n2o_int


def run_all_plots(df):
    plotdata = {}
    treatments={}
    for treatment in np.sort(df['treatment'].unique()):
        # fig, (ax1, ax2, ax3) = plt.subplots(nrows=3, ncols=1, sharex=True)
        tot_n2o_sum = np.array([])
        for plotno in np.sort(df[df['treatment'] == treatment]['nr'].unique()):
            plot_n2o, tot_n2o_sum, n2o_int = getN2Odata(df, plotno, tot_n2o_sum)

            plotdata[plotno] = {
                "name":plotno,
                "data":plot_n2o,
                "dataintsum":n2o_int
            }

        treatments[treatment_legend[treatment]["name"]] = {
            "avg": np.average(tot_n2o_sum),
            "stdev": np.std(tot_n2o_sum)
        }

    return treatments,plotdata

if __name__ == "__main__":

    treatment_legend =  {1: {'name': 'Control N1', 'plots': [9, 19, 30]},
                         2: {'name': 'Control N2', 'plots': [2, 18, 27]},
                         3: {'name': 'Perenial ryegrass N1', 'plots': [12, 23, 25]},
                         4: {'name': 'Perenial ryegrass N2', 'plots': [5, 15, 28]},
                         5: {'name': 'Italian ryegrass N1', 'plots': [10, 17, 29]},
                         6: {'name': 'Italian ryegrass N2', 'plots': [1, 22, 32]},
                         7: {'name': 'Summer vetch N1', 'plots': [4, 20, 36]},
                         8: {'name': 'Winter vetch N1', 'plots': [11, 21, 35]},
                         9: {'name': 'Oilseed radish N1', 'plots': [6, 24, 34]},
                         10: {'name': 'Oilseed radish N2', 'plots': [8, 16, 26]},
                         11: {'name': 'Phaselia N2', 'plots': [7, 14, 31]},
                         12: {'name': 'Grønn bro N1', 'plots': [3, 13, 33]}}

    treatment_df = pd.DataFrame.from_dict(treatment_legend,orient='index')

    start = time()
    filename = "output/capture_slopes.xls"  #filename for raw output
    df = pd.read_excel(filename) # import excel docuument
    df.index= df["Unnamed: 0"]
    df['date'] = pd.to_datetime(df['date']) # make date column to datetime objects
    df = df.sort_values(by=['date']) #sort all entries by date


    fig,axs = plt.subplots(nrows=2, ncols=2,figsize=(15, 12))

    ax1 = plt.subplot(212)
    ax2 = plt.subplot(221)
    ax3 = plt.subplot(222)

    treatments, plotdata = run_all_plots(df)

    for plotno in plotdata:
        ax1.plot(plotdata[plotno]["data"], '-o', picker=True, pickradius=5, label=plotno)
        ax3.plot(plotdata[plotno]["dataintsum"], '-o', picker=True, pickradius=5, label=plotno)
    avgsum = pd.DataFrame.from_dict(treatments, orient='index').sort_index()
    xticks = np.arange(len(avgsum.index))

    ax2.set_ylabel('N2O Emissions\nµG/m²/h')

    ax2.bar(xticks, avgsum.avg, yerr=avgsum.stdev, align='center', alpha=0.5, ecolor='black', capsize=6, picker=True)
    ax2.set_ylabel('N2O Emissions')
    ax2.set_xticks(xticks)
    ax2.set_xticklabels(avgsum.index, rotation=20, ha='right')

    ax2.set_title('Treatment')
    ax2.yaxis.grid(True)

    for label in ax2.get_xticklabels():  # make the xtick labels pickable
        label.set_picker(True)

    # df = df.set_index('date')

    def onpick(event):
        # thisline = event.artist
        # print(thisline)
        # xdata = thisline.get_xdata()
        # ydata = thisline.get_ydata()
        # ind = event.ind
        # points = tuple(zip(xdata[ind], ydata[ind]))
        # print('onpick points:', points)

        if isinstance(event.artist, Line2D):
            thisline = event.artist
            xdata = thisline.get_xdata()
            ydata = thisline.get_ydata()

            ind = event.ind

            points = tuple(zip(xdata[ind], ydata[ind]))
            print('onpick1 line:', thisline.get_label(), xdata[ind][0])
            print(df[(df.nr == int(thisline.get_label())) & (df.date == xdata[ind][0])])


        elif isinstance(event.artist, Rectangle):
            patch = event.artist
            treatment = avgsum.index[int(patch.get_x()+(patch.get_width()/2))]
            treatment_no = treatment_df[treatment_df.name==treatment].index[0]
            ax3.cla()
            ax1.cla()
            for plotno in np.sort(df[df['treatment'] == treatment_no]['nr'].unique()):
                plot_n2o,tot_n2o_sum,n2o_int = getN2Odata(df, plotno)
                ax3.plot(n2o_int,'-o', picker=True, pickradius=5, label=plotno)
                ax1.plot(plot_n2o, '-o', picker=True, pickradius=5, label=plotno)

            ax3.relim()
            ax3.autoscale_view()
            ax1.relim()
            ax1.autoscale_view()
            fig.canvas.draw()
            print('onpick1 patch:', avgsum.index[int(patch.get_x()+(patch.get_width()/2))])

        elif isinstance(event.artist, Text):
            text = event.artist
            print('onpick1 text:', text.get_text())
            fig2, axs2 = plt.subplots(nrows=2, ncols=1, figsize=(15, 12))
            treatment = treatment_df[treatment_df.name == text.get_text()].index[0]


    fig.canvas.mpl_connect('pick_event', onpick)
    plt.show()

            #
            # ax1.plot(plot["date"],n2o_int)
            # ax1.set_ylabel('Cumulative\nNO2 kg/ha/hour')
            #
            # ax2.plot(plot["date"],n2o_sum,'.')
            # ax3.plot(plot["date"], n2o,'.')
            # ax3.set_xlabel("date")
        #
        # ax1.set_title('N2O Release %s %i, %.2f ' % (treatment_legend[treatment]["name"],
        #                                             treatment,
        #                                             np.average(tot_n2o_sum)))
        # plt.gcf().autofmt_xdate()
        # plt.show()